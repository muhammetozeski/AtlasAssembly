using System.Diagnostics;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using AtlasAssembly.Portal.Models;
using Microsoft.JSInterop;

namespace AtlasAssembly.Portal.Services;

/// <summary>Coordinates local engine sessions and capability-scoped room actions with persistent uncertain-write recovery.</summary>
public sealed class AtlasClient(HttpClient http, IJSRuntime js) : IAsyncDisposable
{
 const bool IsLogEnabled = true;
 const string ApiPrefix = "/api/atlas-assembly/";
 static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
 static readonly HashSet<string> PermanentEntryCodes = ["room_full", "room_missing", "room_expired", "registration_expired", "invalid_name", "invalid_access", "invalid_seed", "invalid_body", "invalid_id", "operation_mismatch", "SOLO_ROOM", "ROOM_COMPLETE", "ROOM_FULL", "INVALID_PLAYER"];
 IJSObjectReference? module;
 DotNetObjectReference<AtlasClient>? reference;
 string? observer;
 CancellationTokenSource requests = new();
 long generation, successfulSync;
 bool disposed, visible = true, roomReady;
 public List<Artwork> Artworks { get; private set; } = [];
 public BrowserLibrary Library { get; private set; } = new();
 public PlayerSession? Session { get; private set; }
 public TableSnapshot? Table { get; private set; }
 public RoomEnvelope? Online { get; private set; }
 public RoomConfiguration Configuration { get; private set; } = new();
 public bool Ready { get; private set; }
 public bool Busy { get; private set; }
 public string Message { get; private set; } = "";
 public bool Failed { get; private set; }
 public string ConnectionMessage { get; private set; } = "";
 public bool RoomUnavailable { get; private set; }
 public bool RoomConnected => Session?.Mode == "room" && roomReady;
 public bool HasPending => Session?.Pending is not null || Session?.Registration is not null;
 public bool CanAct => !Busy && !HasPending && visible && Table?.Status == "playing" && Table.Members.Any(person => person.Id == Session?.PlayerId && person.Status == "active") && (Session?.Mode == "solo" || roomReady && Library.Writable);
 public long Generation => generation;
 public event Action? Changed;

 /// <summary>Loads bundled paintings, the private browser library and optional room availability.</summary>
 public async Task Initialize()
 {
  if (Ready) return;
  module ??= await js.InvokeAsync<IJSObjectReference>("import", "./player.mjs");
  Artworks = await http.GetFromJsonAsync<List<Artwork>>("artworks.json") ?? throw new InvalidDataException("The paintings could not be opened.");
  if (Artworks.Count != 3 || Artworks.Any(art => art.Width <= 0 || art.Height <= 0 || !art.ImagePath.StartsWith("artworks/", StringComparison.Ordinal))) throw new InvalidDataException("The painting collection is incomplete.");
  Library = await module.InvokeAsync<BrowserLibrary>("initialize");
  reference ??= DotNetObjectReference.Create(this);
  observer ??= await module.InvokeAsync<string>("observeVisibility", reference);
  Ready = true; Notify();
  try { await CheckRoomAvailability(); }
  catch (Exception error) when (error is HttpRequestException or TaskCanceledException or AtlasFailure) { Log("room availability unavailable", error.GetType().Name, IsLogEnabled); }
  Notify();
 }
 /// <summary>Checks room availability again without resetting local play or inventing a new registration.</summary>
 public async Task CheckRoomAvailability() { Configuration = await Request<RoomConfiguration>(HttpMethod.Get, "config", null, null, requests.Token); Notify(); }

 /// <summary>Runs one user action, preserving failed or canceled work and emitting only safe event metadata.</summary>
 public async Task<bool> Act(string name, Func<Task> action)
 {
  if (Busy || disposed) return false;
  Busy = true; Failed = false; Message = ""; Notify();
  var timer = Stopwatch.StartNew(); var actionGeneration = generation;
  try { await action(); return !disposed; }
  catch (OperationCanceledException) { if (!disposed && actionGeneration == generation) { Failed = true; Message = ConnectionMessage.Length>0 ? "" : HasPending ? "This action is unconfirmed. Check the room before continuing." : "The action stopped. Your assembly is still saved."; } return false; }
  catch (Exception error) { if (!disposed) { Failed = true; Message = Session?.KnownRegistrationError?.Error == error.Message || ConnectionMessage.Length>0&&error is AtlasFailure or HttpRequestException ? "" : error is AtlasFailure or InvalidDataException or ArgumentException ? error.Message : "The action did not finish. Your saved assembly has not been replaced."; try { if(module is not null)await ReadLibrary(); }catch(JSException recovery){Log("library warning unavailable",recovery.GetType().Name,IsLogEnabled);} } Log("action failed", "action=" + name + "; type=" + error.GetType().Name, IsLogEnabled); return false; }
  finally { Busy = false; Log("action ended", "action=" + name + "; elapsedMs=" + timer.ElapsedMilliseconds, IsLogEnabled); Notify(); }
 }

 /// <summary>Opens a separate solo game without replacing existing room or solo records.</summary>
 public async Task StartSolo()
 {
  await Initialize(); ChangeContext();
  var stamp = generation;
  var created = await module!.InvokeAsync<PlayerSession>("newSolo", Artworks.Select(art => new { art.Id, art.Width, art.Height }).ToArray(), "You");
  if (disposed || generation != stamp) return;
  Session = created;
  Online = null; await Project(); await ReadLibrary();
 }
 /// <summary>Restores a private session and reconciles room access before enabling another command.</summary>
 public async Task Open(string id)
 {
  await Initialize(); ChangeContext();
  var stamp = generation;
  var opened = await module!.InvokeAsync<PlayerSession>("open", id);
  if (disposed || generation != stamp) return;
  Session = opened; Online = null;
  if (Session.Mode == "solo") await Project();
  else if (Session.Registration is not null) { Table = null; Message = Session.KnownRegistrationError is null ? "Room entry is unconfirmed. Resume it to recover the same player." : ""; }
  else { await Refresh(true); if (Session.Pending is not null) await Reconcile(); }
 }
 /// <summary>Prepares the recoverable private proof before creating or joining a real persistent room.</summary>
 public async Task EnterRoom(string name, string? roomId = null)
 {
  await Initialize();
  if (!Configuration.Configured) throw new InvalidDataException("Rooms are unavailable right now. You can assemble the paintings alone.");
  name = name.Trim(); if (name.Length is < 1 or > 30) throw new InvalidDataException("Choose a name between 1 and 30 characters.");
  ChangeContext();
  var stamp = generation;
  var result = await module!.InvokeAsync<BrowserSessionResult>("prepareRegistration", roomId is null ? "create" : "join", name, roomId);
  if(!result.Ok||result.Session is null)throw new InvalidDataException(result.Error.Length>0?result.Error:"Room access could not be saved. No room action was sent.");
  var prepared = result.Session;
  if (disposed || generation != stamp) return;
  Session = prepared;
  Online = null; Table = null; await ResumeRegistration();
 }
 /// <summary>Repeats only the stored registration identity, allowing a lost first response to recover the same capabilities.</summary>
 public async Task ResumeRegistration()
 {
  if (Session?.Registration is not { } registration) return;
  if (Session.KnownRegistrationError is { } known) throw new InvalidDataException(known.Error);
  var session = Session; var stamp = generation;
  var kind = registration.GetProperty("kind").GetString();
  var roomId = registration.TryGetProperty("roomId", out var room) ? room.GetString() : null;
  var route = kind == "create" ? "rooms" : "rooms/" + Uri.EscapeDataString(roomId ?? throw new InvalidDataException("The invitation is incomplete.")) + "/join";
  RoomEnvelope result;
  try { result = await Request<RoomEnvelope>(HttpMethod.Post, route, registration.GetProperty("body"), null, requests.Token); }
  catch (AtlasFailure error) when (PermanentEntryCodes.Contains(error.Code))
  {
   if (Current(session, stamp)) { session.KnownRegistrationError = new() { Code = error.Code, Error = error.Message }; await Save(false); }
   throw;
  }
  if (!Current(session, stamp)) return;
  if (result.PlayerId is null || result.PlayerKey is null) throw new InvalidDataException("Room access was not confirmed. Resume this entry before creating another.");
  session.PlayerId = result.PlayerId; session.PlayerKey = result.PlayerKey; session.OwnerKey = result.OwnerKey; session.RoomId = result.Room.Id; session.Registration = null;
  await Apply(result, session, stamp);
 }
 /// <summary>Submits a local command through the production engine or one persisted exact room intent.</summary>
 public async Task Command(object command)
 {
  if (Session is null || Table is null || HasPending) throw new InvalidDataException("Resolve the unfinished action before making another move.");
  if(Session.Mode=="room"&&(!roomReady||!visible||!Library.Writable))throw new InvalidDataException("Reconnect to the room before making another move.");
  var session = Session; var stamp = generation;
  var element = JsonSerializer.SerializeToElement(command, Json);
  if (session.Mode == "solo")
  {
   var result = await module!.InvokeAsync<BrowserSessionResult>("applyLocal", session, element);
   if(!result.Ok||result.Session is null)throw new InvalidDataException(result.Error.Length>0?result.Error:"That move is not available.");
   var updated = result.Session;
   if (!Current(session, stamp)) return;
   Session = updated;
   await Project(); await ReadLibrary(); Notify(); return;
  }
  session.Pending = new() { OpId = await module!.InvokeAsync<string>("operationId"), Revision = Table.Revision, Command = element };
  try { await Save(true); }
  catch(JSException){session.Pending=null;await Save(false);throw new InvalidDataException("This move was not sent because room recovery could not be saved.");}
  if (!Current(session, stamp)) return;
  await SendPending(session, stamp);
 }
 /// <summary>Retries only a frozen stored command; a new operation identifier is never invented after an uncertain write.</summary>
 public async Task RetryPending()
 {
  if (Session?.Pending is null) return;
  await Save(true);
  await SendPending(Session, generation);
 }
 async Task SendPending(PlayerSession session, long stamp)
 {
  var pending = session.Pending ?? throw new InvalidDataException("No unfinished move was found.");
  try
  {
   var response = await Request<RoomEnvelope>(HttpMethod.Post, "rooms/" + session.RoomId + "/commands", new { opId = pending.OpId, revision = pending.Revision, command = pending.Command }, session, requests.Token, pending.Command.TryGetProperty("type", out var type) && type.GetString() == "takeover");
   if (Current(session, stamp)) await ApplyReceipt(response, session, stamp);
  }
  catch (Exception error) when (error is AtlasFailure or HttpRequestException or OperationCanceledException)
  {
   if (Current(session, stamp) && visible)
   {
    try { await Reconcile(); }
    catch (Exception recovery) when (recovery is AtlasFailure or HttpRequestException or OperationCanceledException) { Log("reconcile unavailable", recovery.GetType().Name, IsLogEnabled); }
   }
   if (session.Pending is not null) throw new InvalidDataException("This move is unconfirmed. Check the room, then retry this same move if needed.", error);
  }
 }
 /// <summary>Reads the actor's receipt; an absent or pending receipt keeps new commands blocked.</summary>
 public async Task Reconcile()
 {
  if (!visible) return;
  if (Session?.Pending is not { } pending) { await Refresh(); return; }
  var session = Session; var stamp = generation; var observedSuccess = successfulSync;
  try
  {
   var result = await Request<RoomEnvelope>(HttpMethod.Get, "rooms/" + session.RoomId + "/receipts/" + Uri.EscapeDataString(pending.OpId), null, session, requests.Token);
   if (Current(session, stamp)) await ApplyReceipt(result, session, stamp);
  }
  catch(Exception error) when(error is AtlasFailure or HttpRequestException or OperationCanceledException) { ConnectionFailed(error,session,stamp,observedSuccess); throw; }
 }
 async Task ApplyReceipt(RoomEnvelope response, PlayerSession session, long stamp)
 {
  await Apply(response, session, stamp);
  if (!Current(session, stamp)) return;
  if (response.Receipt is { Status: "accepted" or "rejected" } receipt && receipt.OpId == session.Pending?.OpId)
  {
   session.Pending = null;
   if (receipt.Status == "rejected") { Failed = true; Message = receipt.Error?.Error ?? "The room changed. Choose your move again."; }
   await Save(false);
  }
 }
 /// <summary>Refreshes authoritative room state or renews the current player's lease without replaying a move.</summary>
 public async Task Refresh(bool heartbeat = false)
 {
  if (!visible) return;
  if (Session is not { Mode: "room", PlayerKey: not null, RoomId: not null } session) return;
  var stamp = generation; var observedSuccess = successfulSync;
  try
  {
   var result = await Request<RoomEnvelope>(heartbeat ? HttpMethod.Post : HttpMethod.Get, "rooms/" + session.RoomId + (heartbeat ? "/heartbeat" : ""), heartbeat ? new { } : null, session, requests.Token);
   if (Current(session, stamp)) await Apply(result, session, stamp);
  }
  catch(Exception error) when(error is AtlasFailure or HttpRequestException or OperationCanceledException) { ConnectionFailed(error,session,stamp,observedSuccess); throw; }
 }
 /// <summary>Reconnects using the existing player and reconciles the same pending operation without creating a new move.</summary>
 public async Task Reconnect(){await Refresh(true);if(HasPending)await Reconcile();}
 void ConnectionFailed(Exception error,PlayerSession session,long stamp,long observedSuccess)
 {
  if(!Current(session,stamp)||!visible||observedSuccess!=successfulSync)return;
  roomReady=false;
  RoomUnavailable=error is AtlasFailure failure&&failure.Code is "room_expired" or "room_missing";
  ConnectionMessage=error is AtlasFailure{Code:"room_expired"}?"This shared table has expired.":RoomUnavailable?"This shared table is unavailable.":"Connection lost. Reconnect before making another move.";
  Notify();
 }
 async Task Apply(RoomEnvelope response, PlayerSession session, long stamp)
 {
  if (!Current(session, stamp) || response.Room.Id != session.RoomId || response.Me.PlayerId != session.PlayerId) return;
  if (Online?.Room.Id == response.Room.Id && Online.Room.Revision > response.Room.Revision) return;
  session.State = response.Room.State.Clone(); Online = response;
  await Project(); if (Current(session, stamp)) { successfulSync++; roomReady = true; RoomUnavailable = false; ConnectionMessage = ""; await Save(false); Notify(); }
 }
 async Task Project()
 {
  if (Session?.State is not { } state || Session.PlayerId is null) { Table = null; return; }
  var session = Session; var stamp = generation;
  var projected = await module!.InvokeAsync<TableSnapshot>("snapshot", state, session.PlayerId);
  if (Current(session, stamp)) Table = projected;
 }
 /// <summary>Asks the shared engine whether the final drag position could legally join an owned neighbouring cluster.</summary>
 public async Task<string?> DragCandidate(string groupId, double x, double y)
 {
  if (Session?.State is not { } state || Session.PlayerId is null) return null;
  return await module!.InvokeAsync<string?>("dragCandidate", state, Session.PlayerId, groupId, x, y);
 }
 /// <summary>Returns to the artwork gallery while retaining every saved session and frozen pending action.</summary>
 public void Gallery() { ChangeContext(); Session = null; Table = null; Online = null; Message = ""; Failed = false; Notify(); }
 /// <summary>Pauses requests when hidden and reconciles a room before restoring its controls after return.</summary>
 [JSInvokable] public async Task OnVisibilityChanged(bool isVisible)
 {
  if (disposed || visible == isVisible) return;
  visible = isVisible; ChangeContext(); Notify();
  if (visible && Session is { Mode: "room", Registration: null })
  {
   try { await Refresh(true); if (HasPending) await Reconcile(); }
   catch (Exception error) when (error is AtlasFailure or HttpRequestException or OperationCanceledException)
   {
    Log("return refresh unavailable", error.GetType().Name, IsLogEnabled);
   }
  }
 }
 async Task Save(bool required) { if (Session is not null) Library = await module!.InvokeAsync<BrowserLibrary>("save", Session, required); }
 async Task ReadLibrary() => Library = await module!.InvokeAsync<BrowserLibrary>("library");
 void ChangeContext() { generation++; roomReady = false; RoomUnavailable = false; ConnectionMessage = ""; requests.Cancel(); requests.Dispose(); requests = new(); }
 bool Current(PlayerSession session, long stamp) => !disposed && stamp == generation && ReferenceEquals(Session, session);
 void Notify() { if (!disposed) Changed?.Invoke(); }

 async Task<T> Request<T>(HttpMethod method, string route, object? body, PlayerSession? session, CancellationToken cancellation, bool owner = false)
 {
  using var lifetime = CancellationTokenSource.CreateLinkedTokenSource(cancellation); lifetime.CancelAfter(TimeSpan.FromSeconds(10));
  using var request = new HttpRequestMessage(method, ApiPrefix + route);
  if (session?.PlayerKey is not null) request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", session.PlayerKey);
  if (owner && session?.OwnerKey is not null) request.Headers.Add("X-Atlas-Owner-Key", session.OwnerKey);
  if (body is not null) request.Content = JsonContent.Create(body, options: Json);
  using var response = await http.SendAsync(request, lifetime.Token);
  Log("room response", "method=" + method.Method + "; status=" + (int)response.StatusCode, IsLogEnabled);
  if (!response.IsSuccessStatusCode)
  {
   ApiError? failure = null;
   try { failure = await response.Content.ReadFromJsonAsync<ApiError>(Json, lifetime.Token); } catch (JsonException) { Log("room response unreadable", isRun: IsLogEnabled); }
   throw new AtlasFailure((int)response.StatusCode, failure?.Code ?? "REQUEST_FAILED", failure?.Error ?? "The room could not be reached. Your assembly is still saved.");
  }
  return await response.Content.ReadFromJsonAsync<T>(Json, lifetime.Token) ?? throw new InvalidDataException("No room state was returned. Check the room before continuing.");
 }
 /// <summary>Cancels requests and removes only this instance's browser observer; private saved sessions are retained.</summary>
 public async ValueTask DisposeAsync()
 {
  if (disposed) return; disposed = true; requests.Cancel(); requests.Dispose();
  if (module is not null)
  {
   try { if (observer is not null) await module.InvokeVoidAsync("stopObserving", observer); await module.DisposeAsync(); }
   catch (JSException error) { Log("browser cleanup unavailable", error.GetType().Name, IsLogEnabled); }
  }
  reference?.Dispose();
 }
}
/// <summary>Preserves the bounded service refusal for the outer user-action boundary.</summary>
public sealed class AtlasFailure(int status, string code, string message) : Exception(message) { public int Status { get; } = status; public string Code { get; } = code; }
