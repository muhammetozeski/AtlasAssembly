namespace AtlasAssembly.Portal.Models;

/// <summary>Describes a bundled museum image and its original attribution; it contains no player state.</summary>
public sealed class Artwork
{
 public string Id { get; set; } = "";
 public long ObjectId { get; set; }
 public string Title { get; set; } = "";
 public string SourceTitle { get; set; } = "";
 public string Artist { get; set; } = "";
 public string Date { get; set; } = "";
 public string ImagePath { get; set; } = "";
 public int Width { get; set; }
 public int Height { get; set; }
 public string ObjectUrl { get; set; } = "";
 public string CreditLine { get; set; } = "";
 public string License { get; set; } = "";
 public string LicenseUrl { get; set; } = "";
}
