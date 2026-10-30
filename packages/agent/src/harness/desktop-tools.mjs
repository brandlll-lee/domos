const desktopMaintenance = new Set([
  "get_config",
  "set_config",
  "get_recording_state",
  "start_recording",
  "stop_recording",
  "replay_trajectory",
  "check_for_update",
  "install_ffmpeg",
  "check_permissions",
  "health_report",
  "debug_window_info",
  "get_agent_cursor_state",
  "set_agent_cursor_enabled",
  "set_agent_cursor_motion",
  "set_agent_cursor_style",
  "set_agent_cursor_theme",
  "get_session",
  "list_sessions",
  "get_session_state",
  "escalate_session",
]);

export function desktopToolListed(name, browser) {
  return (
    !desktopMaintenance.has(name) &&
    !(
      browser &&
      (name.startsWith("browser_") ||
        ["get_browser_state", "page"].includes(name))
    )
  );
}
