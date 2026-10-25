using System.Text.Json;

namespace AtlasAssembly.Portal.Models;

/// <summary>Receives room state and a receipt separately; temporary browser animation never supplies these records.</summary>
public sealed class RoomEnvelope
{
 public RoomData Room { get; set; } = new();
 public PlayerIdentity Me { get; set; } = new();
 public long ServerTime { get; set; }
 public CommandReceipt? Receipt { get; set; }
 public bool Found { get; set; }
 public string? PlayerId { get; set; }
 public string? PlayerKey { get; set; }
 public string? OwnerKey { get; set; }
 public string? InviteUrl { get; set; }
}
/// <summary>Contains an authorized room snapshot and its server-owned revision, retention and presence leases.</summary>
public sealed class RoomData
{
 public string Id { get; set; } = "";
 public int Revision { get; set; }
 public JsonElement State { get; set; }
 public long ExpiresAt { get; set; }
 public List<PresenceLease> Presence { get; set; } = [];
}
/// <summary>Projects the actor resolved from the bearer capability, rather than a browser-supplied identity.</summary>
public sealed class PlayerIdentity { public string PlayerId { get; set; } = ""; public bool IsOwner { get; set; } }
/// <summary>Identifies the disposition of one exact action; an absent receipt is not proof that a request was never dispatched.</summary>
public sealed class CommandReceipt { public string OpId { get; set; } = ""; public string Status { get; set; } = "pending"; public int? Revision { get; set; } public ApiError? Error { get; set; } }
/// <summary>Displays a room participant's lease using the server's clock.</summary>
public sealed class PresenceLease { public string PlayerId { get; set; } = ""; public long LeaseUntil { get; set; } public long? ReclaimedAt { get; set; } }
/// <summary>Receives the service's bounded refusal text without including private request headers.</summary>
public sealed class ApiError { public string Code { get; set; } = ""; public string Error { get; set; } = ""; }
/// <summary>Supplies room polling intervals while solo play remains independent of the room service.</summary>
public sealed class RoomConfiguration { public bool Configured { get; set; } public int HeartbeatSeconds { get; set; } = 20; public int PollSeconds { get; set; } = 3; }
