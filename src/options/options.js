const DEFAULTS = { autoOnSend: true, backfillDays: 90 };

for (const el of document.querySelectorAll("[data-i18n]")) {
  el.textContent = messenger.i18n.getMessage(el.dataset.i18n);
}

const auto = document.getElementById("autoOnSend");
const days = document.getElementById("backfillDays");
const saved = document.getElementById("saved");

async function load() {
  const opts = { ...DEFAULTS, ...(await messenger.storage.local.get(Object.keys(DEFAULTS))) };
  auto.checked = opts.autoOnSend;
  days.value = opts.backfillDays;
}

async function save() {
  const n = Math.max(1, Math.min(3650, parseInt(days.value, 10) || DEFAULTS.backfillDays));
  days.value = n;
  await messenger.storage.local.set({ autoOnSend: auto.checked, backfillDays: n });
  saved.style.visibility = "visible";
  setTimeout(() => (saved.style.visibility = "hidden"), 1200);
}

auto.addEventListener("change", save);
days.addEventListener("change", save);
load();
