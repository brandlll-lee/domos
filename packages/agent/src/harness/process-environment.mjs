const inherited = [
  "PATH",
  "Path",
  "SystemRoot",
  "SYSTEMROOT",
  "WINDIR",
  "COMSPEC",
  "PATHEXT",
  "TEMP",
  "TMP",
  "TMPDIR",
  "LANG",
  "LC_ALL",
  "DISPLAY",
  "XAUTHORITY",
  "XDG_RUNTIME_DIR",
  "DBUS_SESSION_BUS_ADDRESS",
  "AT_SPI_BUS_ADDRESS",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "http_proxy",
  "https_proxy",
  "NO_PROXY",
  "no_proxy",
];

export function processEnvironment(spec, home, source) {
  const env = Object.fromEntries(
    Object.entries(source).filter(([key]) => inherited.includes(key)),
  );
  return Object.assign(env, { HOME: home, USERPROFILE: home }, spec.env);
}
