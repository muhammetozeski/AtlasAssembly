namespace AtlasAssembly.Portal.Services;

/// <summary>Writes bounded event metadata to the browser console without identities, room contents or capabilities.</summary>
public static class BrowserLog
{
 /// <summary>Records the event name and a caller-created safe summary; raw responses and credential objects are never accepted.</summary>
 public static void Log(string eventName, string safeSummary = "", bool isRun = true)
 {
  if (isRun) Console.WriteLine("Atlas " + eventName + (safeSummary.Length > 0 ? "; " + safeSummary : ""));
 }
}
