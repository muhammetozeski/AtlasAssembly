using System.Text.Json;

namespace AtlasAssembly.Portal.Models;

/// <summary>Projects the engine's rendering snapshot; all movement and joining rules stay in the shared engine.</summary>
public sealed class TableSnapshot
{
 public int Revision { get; set; }
 public string Status { get; set; } = "playing";
 public string Mode { get; set; } = "solo";
 public string OwnerId { get; set; } = "";
 public string YouId { get; set; } = "";
 public List<AssemblyGroup> Groups { get; set; } = [];
 public List<TableMember> Members { get; set; } = [];
 public List<ClusterOffer> Offers { get; set; } = [];
}

/// <summary>Contains a cluster's engine-authored pose, ownership and projected image tiles.</summary>
public sealed class AssemblyGroup
{
 public string Id { get; set; } = "";
 public string ArtworkId { get; set; } = "";
 public List<string> PieceIds { get; set; } = [];
 public string Location { get; set; } = "rack";
 public string? OwnerId { get; set; }
 public double X { get; set; }
 public double Y { get; set; }
 public int Rotation { get; set; }
 public int Version { get; set; }
 public List<string> Contributors { get; set; } = [];
 public List<ImageTile> Tiles { get; set; } = [];
}

/// <summary>Describes one image crop around an engine-projected centre in board coordinates.</summary>
public sealed class ImageTile
{
 public string PieceId { get; set; } = "";
 public string ArtworkId { get; set; } = "";
 public int Col { get; set; }
 public int Row { get; set; }
 public double X { get; set; }
 public double Y { get; set; }
 public double Width { get; set; } = 1;
 public double Height { get; set; }
 public int Rotation { get; set; }
}

/// <summary>Displays only the participant information already included in an authorized room snapshot.</summary>
public sealed class TableMember
{
 public string Id { get; set; } = "";
 public string Name { get; set; } = "";
 public string Status { get; set; } = "active";
}

/// <summary>References a proposed transfer of an existing cluster, never a copied assembly.</summary>
public sealed class ClusterOffer
{
 public string Id { get; set; } = "";
 public string GroupId { get; set; } = "";
 public string FromId { get; set; } = "";
 public string ToId { get; set; } = "";
 public string Status { get; set; } = "pending";
}

/// <summary>Stores one private local session, keeping registration and action recovery separate from public room state.</summary>
public sealed class PlayerSession
{
 public string Id { get; set; } = "";
 public string Mode { get; set; } = "solo";
 public string Name { get; set; } = "";
 public string? RoomId { get; set; }
 public string? PlayerId { get; set; }
 public string? PlayerKey { get; set; }
 public string? OwnerKey { get; set; }
 public JsonElement? State { get; set; }
 public JsonElement? Registration { get; set; }
 public ApiError? KnownRegistrationError { get; set; }
 public PendingCommand? Pending { get; set; }
 public long SavedAt { get; set; }
}

/// <summary>Freezes one uncertain write before transmission so a later session can reconcile the same operation.</summary>
public sealed class PendingCommand
{
 public string OpId { get; set; } = "";
 public int Revision { get; set; }
 public JsonElement Command { get; set; }
}

/// <summary>Summarizes recoverable local sessions without placing their capabilities in the visible interface.</summary>
public sealed class SessionSummary
{
 public string Id { get; set; } = "";
 public string Mode { get; set; } = "solo";
 public string Name { get; set; } = "";
 public string? RoomId { get; set; }
 public long SavedAt { get; set; }
 public bool EntryUnavailable { get; set; }
}

/// <summary>Reports usable browser session state and an explicit persistence warning.</summary>
public sealed class BrowserLibrary
{
 public List<SessionSummary> Sessions { get; set; } = [];
 public string Warning { get; set; } = "";
 public bool Writable { get; set; }
}
/// <summary>Conveys a usable local session or a bounded rule/storage refusal without exposing a JavaScript stack.</summary>
public sealed class BrowserSessionResult { public bool Ok { get; set; } public PlayerSession? Session { get; set; } public string Error { get; set; } = ""; }
