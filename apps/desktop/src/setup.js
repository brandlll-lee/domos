const form = document.getElementById("setup");
const remote = document.getElementById("remote");
const status = document.getElementById("status");
const error = document.getElementById("error");
const cancel = document.getElementById("cancel");
const submit = document.getElementById("continue");
const radios = [...document.querySelectorAll('input[name="mode"]')];
let busy = false;
const setBusy = (value) => {
  busy = value;
  submit.disabled = value;
  cancel.hidden = !value;
  for (const radio of radios) radio.disabled = value;
};
for (const radio of radios)
  radio.addEventListener("change", () => {
    remote.hidden = form.elements.mode.value !== "existing";
    document.getElementById("hint").hidden = !remote.hidden;
    error.textContent = "";
  });
window.domos.progress((value) => {
  status.textContent = value.message;
});
cancel.addEventListener("click", () => void window.domos.cancel());
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (busy) return;
  setBusy(true);
  error.textContent = "";
  try {
    const result =
      form.elements.mode.value === "local"
        ? await window.domos.host()
        : await window.domos.connect(
            document.getElementById("url").value,
            document.getElementById("name").value,
          );
    if (!result.ok) error.textContent = result.error;
  } catch {
    error.textContent = "连接未完成。请重试。";
  } finally {
    setBusy(false);
  }
});
for (const action of ["backup", "restore"])
  document.getElementById(action).addEventListener("click", async () => {
    if (busy) return;
    const password = document.getElementById("password");
    if (password.value.length < 12) {
      error.textContent = "备份密码至少需要 12 个字符。";
      password.focus();
      return;
    }
    setBusy(true);
    error.textContent = "";
    status.textContent = "正在维护托管环境…";
    try {
      const result = await window.domos.maintain(action, password.value);
      if (!result.ok) error.textContent = result.error;
      status.textContent = result.value?.message ?? "";
    } finally {
      password.value = "";
      setBusy(false);
    }
  });
