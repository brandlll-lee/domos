const bridge = window.domosSetup;
const form = document.querySelector("#setup");
const choices = document.querySelector("#choices");
const remote = document.querySelector("#remote");
const address = document.querySelector("#url");
const name = document.querySelector("#name");
const saved = document.querySelector("#saved");
const progress = document.querySelector("#progress");
const phase = document.querySelector("#phase");
const error = document.querySelector("#error");
const docker = document.querySelector("#docker");
const cancel = document.querySelector("#cancel");
const next = document.querySelector("#continue");
let connections = [];
let stage;

function updateMode() {
  const local = new FormData(form).get("mode") === "local";
  remote.hidden = local;
  address.required = !local;
  name.required = !local;
  error.hidden = true;
  docker.hidden = true;
}
form.addEventListener("change", updateMode);
saved.addEventListener("change", () => {
  const connection = connections.find((item) => item.id === saved.value);
  if (!connection) return;
  address.value = connection.url;
  name.value = connection.name;
});
bridge.progress((value) => {
  stage = value.phase;
  phase.textContent = value.message;
});
cancel.addEventListener("click", () => bridge.cancel());
docker.addEventListener("click", () => bridge.docker());
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const local = new FormData(form).get("mode") === "local";
  choices.disabled = true;
  next.disabled = true;
  remote.inert = true;
  progress.hidden = false;
  cancel.hidden = !local;
  error.hidden = true;
  docker.hidden = true;
  stage = undefined;
  phase.textContent = local ? "正在准备本机服务…" : "正在检查服务器…";
  try {
    const result = await bridge.submit(
      local
        ? { mode: "local" }
        : { mode: "existing", url: address.value, name: name.value },
    );
    if (result.cancelled) {
      error.textContent = "准备已取消。可以重试。";
      error.hidden = false;
      return;
    }
    if (!result.ok) throw new Error(result.error);
  } catch (cause) {
    error.textContent = cause.message;
    error.hidden = false;
    docker.hidden = !local || stage !== "checking";
    next.textContent = "重试";
  } finally {
    choices.disabled = false;
    next.disabled = false;
    remote.inert = false;
    progress.hidden = true;
    cancel.hidden = true;
  }
});
bridge.state().then((state) => {
  connections = state.instances.filter((item) => item.mode === "existing");
  for (const connection of connections) {
    const option = document.createElement("option");
    option.value = connection.id;
    option.textContent = connection.name;
    saved.append(option);
  }
  document.querySelector("#saved-label").hidden = !connections.length;
  if (!state.prepare && state.selected?.mode === "existing") {
    form.querySelector('[value="existing"]').checked = true;
    address.value = state.selected.url;
    name.value = state.selected.name;
    saved.value = state.selected.id;
    updateMode();
  }
  if (state.error) {
    error.textContent = state.error;
    error.hidden = false;
  }
  if (state.prepare) form.requestSubmit();
});
