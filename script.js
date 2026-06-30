const STORAGE_KEY = "lqd-service-form-editor-v1";

const defaultConfirmation =
  "Роботи виконані в повному обсязі, зауважень до Виконавця по виконаних роботах та кількості використаних матеріалів немає.";

const DEFAULT_TABLE_ROWS = 9;

const lineDefaults = {
  otherWorks: 6,
  extraMaterials: 5,
  executorRecommendations: 6,
  customerNotes: 6
};

const lineTitles = {
  otherWorks: "Інші роботи",
  extraMaterials: "Додаткові матеріали та комплектуючі",
  executorRecommendations: "Рекомендації Виконавця",
  customerNotes: "Побажання чи зауваження Замовника"
};

const lineOrder = [
  "otherWorks",
  "extraMaterials",
  "executorRecommendations",
  "customerNotes"
];

const documentsRoot = document.querySelector("#documents");
const documentTemplate = document.querySelector("#documentTemplate");
const saveStatus = document.querySelector("#saveStatus");
const crmLinkInput = document.querySelector("#crmLinkInput");
const crmImportButton = document.querySelector("#importCrmBtn");
const crmImportStatus = document.querySelector("#crmImportStatus");
const CRM_PROXY_BASE = "http://127.0.0.1:8787";
const CRM_PROXY_ENDPOINT = `${CRM_PROXY_BASE}/crm?url=`;
const CRM_PROXY_HEALTH_ENDPOINT = `${CRM_PROXY_BASE}/health`;
const CRM_DEFAULT_EXECUTOR = "Володимир Дунець";

let state = loadState();
let saveTimer = null;
let layoutFrame = null;

function createRows(count) {
  return Array.from({ length: count }, () => ({ name: "", qty: "", note: "" }));
}

function createLines(count) {
  return Array.from({ length: count }, () => "");
}

function createDocument() {
  return {
    id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()),
    fields: {
      orderNumber: "",
      orderDate: "",
      workDate: "",
      executor: "",
      customer: "",
      object: "",
      planned: false,
      urgent: false,
      confirmationText: defaultConfirmation,
      executorSignature: "",
      customerSignature: ""
    },
    services: createRows(DEFAULT_TABLE_ROWS),
    materials: createRows(DEFAULT_TABLE_ROWS),
    lines: {
      otherWorks: createLines(lineDefaults.otherWorks),
      extraMaterials: createLines(lineDefaults.extraMaterials),
      executorRecommendations: createLines(lineDefaults.executorRecommendations),
      customerNotes: createLines(lineDefaults.customerNotes)
    }
  };
}

function normalizeDocument(doc) {
  const base = createDocument();
  return {
    ...base,
    ...doc,
    fields: { ...base.fields, ...(doc?.fields || {}) },
    services: normalizeRows(doc?.services, base.services),
    materials: normalizeRows(doc?.materials, base.materials),
    lines: {
      otherWorks: normalizeLines(doc?.lines?.otherWorks, lineDefaults.otherWorks),
      extraMaterials: normalizeLines(doc?.lines?.extraMaterials, lineDefaults.extraMaterials),
      executorRecommendations: normalizeLines(doc?.lines?.executorRecommendations, lineDefaults.executorRecommendations),
      customerNotes: normalizeLines(doc?.lines?.customerNotes, lineDefaults.customerNotes)
    }
  };
}

function normalizeLines(value, count) {
  return Array.isArray(value) && value.length ? value : createLines(count);
}

function normalizeRows(value, fallbackRows) {
  if (!Array.isArray(value) || !value.length) return fallbackRows;

  if (value.length === 10 && isEmptyRow(value[9])) {
    return value.slice(0, DEFAULT_TABLE_ROWS);
  }

  return value;
}

function isEmptyRow(row) {
  return !String(row?.name || "").trim() &&
    !String(row?.qty || "").trim() &&
    !String(row?.note || "").trim();
}

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved?.documents?.length) {
      return {
        crmLink: saved.crmLink || "",
        documents: saved.documents.map(normalizeDocument)
      };
    }
  } catch (error) {
    console.warn("Не вдалося прочитати автозбереження", error);
  }

  return { crmLink: "", documents: [createDocument()] };
}

function queueSave() {
  saveStatus.textContent = "Збереження...";
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    saveStatus.textContent = "Збережено автоматично";
  }, 250);
}

function scheduleLayout() {
  if (layoutFrame !== null) cancelAnimationFrame(layoutFrame);
  layoutFrame = requestAnimationFrame(() => {
    layoutFrame = null;
    fitAllDocuments();
  });
}

function fitAllDocuments() {
  document.querySelectorAll(".document-set").forEach(fitLineBlocks);
}

function fitLineBlocks(set) {
  const servicePage = set.querySelector(".service-page");
  const mainTarget = set.querySelector('[data-line-blocks-target="main"]');
  const signTarget = set.querySelector('[data-line-blocks-target="sign"]');

  if (!servicePage || !mainTarget || !signTarget) return;

  while (signTarget.firstElementChild) {
    mainTarget.appendChild(signTarget.firstElementChild);
  }

  set.dataset.movedBlocks = "0";
  set.classList.remove("extended-document");

  const pageHeight = Math.round(servicePage.getBoundingClientRect().height) || servicePage.clientHeight;
  const tolerance = 2;
  let movedCount = 0;

  while (
    servicePage.scrollHeight > pageHeight + tolerance &&
    mainTarget.lastElementChild &&
    movedCount < lineOrder.length
  ) {
    signTarget.prepend(mainTarget.lastElementChild);
    movedCount += 1;
    set.dataset.movedBlocks = String(movedCount);
    set.classList.add("extended-document");
  }

  if (movedCount === 0) {
    set.dataset.movedBlocks = "0";
    set.classList.remove("extended-document");
  }
}

function getDoc(id) {
  return state.documents.find((doc) => doc.id === id);
}

function setCrmStatus(message, kind = "") {
  if (!crmImportStatus) return;
  crmImportStatus.textContent = message;
  crmImportStatus.dataset.kind = kind;
}

function buildCrmApiUrl(url) {
  const parts = url.pathname.split("/").filter(Boolean);
  const apiIndex = parts.indexOf("api");
  const wIndex = parts.indexOf("w");

  if (apiIndex >= 0 && parts[apiIndex + 1] === "w" && parts[apiIndex + 2] && parts[apiIndex + 3]) {
    return `${url.origin}/api/w/${parts[apiIndex + 2]}/${parts[apiIndex + 3]}`;
  }

  if (wIndex >= 0 && parts[wIndex + 1] && parts[wIndex + 2]) {
    return `${url.origin}/api/w/${parts[wIndex + 1]}/${parts[wIndex + 2]}`;
  }

  return "";
}

async function resolveCrmApiUrl(rawLink) {
  const trimmedLink = rawLink.trim();
  const normalizedLink = /^https?:\/\//i.test(trimmedLink)
    ? trimmedLink
    : `https://${trimmedLink}`;
  let url;

  try {
    url = new URL(normalizedLink);
  } catch {
    throw new Error("CRM_LINK_FORMAT");
  }

  const directApiUrl = buildCrmApiUrl(url);

  if (directApiUrl) return directApiUrl;

  if (url.hostname === "roapp.link") {
    const response = await fetch(url.href, { redirect: "follow" });
    const resolvedApiUrl = buildCrmApiUrl(new URL(response.url));
    if (resolvedApiUrl) return resolvedApiUrl;
  }

  throw new Error("CRM_LINK_FORMAT");
}

async function fetchCrmOrderDirect(rawLink) {
  const apiUrl = await resolveCrmApiUrl(rawLink);
  const response = await fetch(apiUrl, {
    headers: { Accept: "application/json" }
  });

  if (!response.ok) {
    throw new Error(`CRM_HTTP_${response.status}`);
  }

  return response.json();
}

function crmNormalizeLink(rawLink) {
  const value = String(rawLink || "").trim();
  if (!value) throw new Error("CRM_LINK_FORMAT");
  return /^https?:\/\//i.test(value) ? value : `https://${value}`;
}

function crmIsRoappLink(rawLink) {
  try {
    const url = new URL(crmNormalizeLink(rawLink));
    return url.hostname === "roapp.link" ||
      url.hostname === "roapp.page" ||
      url.hostname.endsWith(".roapp.page");
  } catch {
    return false;
  }
}

async function checkCrmProxyHealth() {
  try {
    const response = await fetch(CRM_PROXY_HEALTH_ENDPOINT, {
      cache: "no-store",
      headers: { Accept: "application/json" }
    });
    if (!response.ok) return false;
    const data = await response.json().catch(() => ({}));
    return data.ok === true;
  } catch {
    return false;
  }
}

async function ensureCrmProxyHealth() {
  const ok = await checkCrmProxyHealth();
  if (!ok) throw new Error("CRM_PROXY_UNAVAILABLE");
}

async function fetchCrmOrder(rawLink) {
  crmNormalizeLink(rawLink);

  if (crmIsRoappLink(rawLink) || window.location.protocol === "file:") {
    await ensureCrmProxyHealth();
    return {
      data: await fetchCrmOrderViaProxy(rawLink),
      source: "proxy"
    };
  }

  try {
    return {
      data: await fetchCrmOrderDirect(rawLink),
      source: "direct"
    };
  } catch {
    await ensureCrmProxyHealth();
    return {
      data: await fetchCrmOrderViaProxy(rawLink),
      source: "proxy"
    };
  }
}

async function fetchCrmOrderViaProxy(rawLink) {
  let response;

  try {
    response = await fetch(`${CRM_PROXY_ENDPOINT}${encodeURIComponent(rawLink)}`, {
      cache: "no-store",
      headers: { Accept: "application/json" }
    });
  } catch {
    throw new Error("CRM_PROXY_UNAVAILABLE");
  }

  const payload = await response.json().catch(() => null);

  if (!response.ok || payload?.ok === false) {
    const error = new Error("CRM_PROXY_ERROR");
    error.crm = payload || {
      code: `proxy_http_${response.status}`,
      error: "CRM-проксі повернув помилку без JSON-деталей."
    };
    throw error;
  }

  return payload;
}

function crmPath(source, path) {
  return path.split(".").reduce((current, key) => {
    if (current === null || current === undefined) return undefined;
    return current[key];
  }, source);
}

function crmText(value) {
  if (value === null || value === undefined) return "";
  if (typeof value !== "object") return String(value).trim();

  return [
    value.fullname,
    value.fullName,
    value.name,
    value.title,
    value.label,
    value.address,
    value.fullAddress,
    value.city,
    value.street,
    value.house,
    value.apartment,
    value.serialNumber,
    value.inventoryNumber
  ]
    .map((item) => crmText(item))
    .filter(Boolean)
    .join(", ");
}

function crmFirstText(source, paths) {
  for (const path of paths) {
    const text = crmText(crmPath(source, path));
    if (text) return text;
  }
  return "";
}

function crmFirstValue(source, paths) {
  for (const path of paths) {
    const value = crmPath(source, path);
    if (value !== null && value !== undefined && value !== "") return value;
  }
  return "";
}

function crmArray(value) {
  return Array.isArray(value) ? value : [];
}

function formatCrmDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return crmText(value);

  return date.toLocaleDateString("uk-UA", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  });
}

function createBlankRow() {
  return { name: "", qty: "", note: "" };
}

function crmItemKind(item, defaultKind = "") {
  const raw = crmFirstText(item, ["type", "category", "kind", "itemType", "group", "entity"]).toLowerCase();
  const services = new Set(["service", "services", "work", "works", "labor", "labour"]);
  const materials = new Set(["product", "products", "material", "materials", "good", "goods", "part", "parts"]);

  if (services.has(raw)) return "service";
  if (materials.has(raw)) return "material";
  return defaultKind || "service";
}

function crmRow(item) {
  const qty = crmFirstText(item, ["quantity", "qty", "amount", "count"]);
  const unit = crmFirstText(item, ["uomTitle", "unit", "uom", "measure"]);

  return {
    name: crmFirstText(item, [
      "title",
      "name",
      "description",
      "product.title",
      "product.name",
      "service.title",
      "service.name"
    ]),
    qty: [qty, unit].filter(Boolean).join(" "),
    note: crmFirstText(item, ["comment", "note", "remark"])
  };
}

function crmPushRows(target, items, defaultKind = "") {
  items.forEach((item) => {
    const row = crmRow(item);
    if (!row.name && !row.qty && !row.note) return;

    if (crmItemKind(item, defaultKind) === "material") {
      target.materials.push(row);
    } else {
      target.services.push(row);
    }
  });
}

function normalizeCrmOrder(data) {
  const source = data?.data && typeof data.data === "object" ? data.data : data;
  const result = {
    fields: {
      orderNumber: crmFirstText(source, ["number", "orderNumber", "id", "code"]),
      orderDate: formatCrmDate(crmFirstValue(source, ["createdAt", "created_at", "date", "orderDate"])),
      workDate: formatCrmDate(crmFirstValue(source, ["dueDate", "acceptedAt", "workDate", "executionDate", "completedAt"])),
      executor: CRM_DEFAULT_EXECUTOR,
      customer: crmFirstText(source, [
        "client.fullname",
        "client.fullName",
        "client.name",
        "customer.name",
        "customer.fullname",
        "customer.fullName",
        "contact.name"
      ]),
      object: crmFirstText(source, ["asset", "object", "equipment", "location", "address"])
    },
    services: [],
    materials: []
  };

  crmPushRows(result, crmArray(source.services), "service");
  crmPushRows(result, crmArray(source.works), "service");
  crmPushRows(result, crmArray(source.materials), "material");
  crmPushRows(result, crmArray(source.products), "material");
  crmPushRows(result, crmArray(source.items));
  crmPushRows(result, crmArray(source.orderItems));

  return result;
}

function applyCrmOrder(doc, data) {
  const normalized = normalizeCrmOrder(data);
  doc.fields.orderNumber = normalized.fields.orderNumber;
  doc.fields.orderDate = normalized.fields.orderDate;
  doc.fields.workDate = normalized.fields.workDate;
  doc.fields.executor = normalized.fields.executor;
  doc.fields.customer = normalized.fields.customer;
  doc.fields.object = normalized.fields.object;
  doc.services = normalized.services;
  doc.materials = normalized.materials;
}

function getCrmErrorMessage(error) {
  if (error?.message === "CRM_LINK_FORMAT") {
    return "Не вдалося розпізнати CRM-посилання.";
  }

  if (error?.message === "CRM_PROXY_UNAVAILABLE") {
    const fileHint = window.location.protocol === "file:"
      ? " Поточну сторінку відкрито як файл. Для CRM-імпорту краще відкривати редактор через open-editor.cmd."
      : "";
    return `CRM-проксі не запущено. Відкрий open-editor.cmd або запусти start-crm-proxy.cmd і повтори імпорт.${fileHint}`;
  }

  const crm = error?.crm;
  if (crm?.code) {
    const details = crm.details || {};
    const preview = details.preview ? ` Відповідь CRM: ${details.preview}` : "";

    if (crm.code === "domain_not_allowed") {
      return "Це посилання не з дозволеного домену CRM.";
    }
    if (crm.code === "short_link_resolve_failed") {
      return "Не вдалося розгорнути коротке CRM-посилання.";
    }
    if (crm.code === "api_url_not_found") {
      return "Не вдалося знайти API-адресу в CRM-посиланні. Можливо, потрібен офіційний API або авторизація.";
    }
    if (crm.code === "crm_non_json") {
      return `CRM повернула HTML або інший не-JSON вміст замість даних замовлення.${preview}`;
    }
    if (crm.code === "crm_http_401" || crm.code === "crm_http_403") {
      return "CRM вимагає авторизацію. Для цього посилання потрібен офіційний API, токен або інший доступ до даних.";
    }
    if (crm.code?.startsWith("crm_http_")) {
      return `CRM повернула помилку ${details.status || ""}. ${crm.error || ""}${preview}`.trim();
    }

    return [crm.error, preview].filter(Boolean).join(" ");
  }

  if (error instanceof TypeError) {
    return "Браузер заблокував пряме читання CRM. Відкрий редактор через open-editor.cmd і повтори імпорт.";
  }

  return "Не вдалося завантажити замовлення з CRM.";
}

async function importCrmOrder() {
  const link = crmLinkInput?.value.trim() || "";
  if (!link) {
    setCrmStatus("Встав посилання CRM-замовлення.", "error");
    return;
  }

  if (crmImportButton) crmImportButton.disabled = true;
  setCrmStatus("Завантаження з CRM...", "loading");

  try {
    const result = await fetchCrmOrder(link);
    if (!state.documents.length) state.documents.push(createDocument());

    applyCrmOrder(state.documents[0], result.data);
    state.crmLink = link;
    render();
    queueSave();
    scheduleLayout();
    setCrmStatus("Бланк заповнено з CRM.", "success");
  } catch (error) {
    console.warn("CRM import failed", error);
    state.crmLink = link;
    queueSave();
    setCrmStatus(getCrmErrorMessage(error), "error");
  } finally {
    if (crmImportButton) crmImportButton.disabled = false;
  }
}

function render() {
  documentsRoot.replaceChildren();

  state.documents.forEach((doc, index) => {
    const fragment = documentTemplate.content.cloneNode(true);
    const set = fragment.querySelector(".document-set");
    set.dataset.docId = doc.id;
    set.dataset.movedBlocks = "0";
    set.classList.remove("extended-document");
    fragment.querySelector(".document-name").textContent = `Анкета ${index + 1}`;

    fillFields(fragment, doc);
    renderTable(fragment, doc, "services");
    renderTable(fragment, doc, "materials");
    renderLines(fragment, doc);

    const removeButton = fragment.querySelector('[data-action="remove-document"]');
    removeButton.disabled = state.documents.length === 1;
    removeButton.title = state.documents.length === 1
      ? "Останню анкету не можна видалити"
      : "Видалити цю анкету";

    documentsRoot.appendChild(fragment);
  });

  scheduleLayout();
}

function fillFields(root, doc) {
  root.querySelectorAll("[data-field]").forEach((field) => {
    const key = field.dataset.field;
    field.textContent = doc.fields[key] || "";
  });

  root.querySelector('[data-check="planned"]').checked = Boolean(doc.fields.planned);
  root.querySelector('[data-check="urgent"]').checked = Boolean(doc.fields.urgent);
}

function renderTable(root, doc, tableName) {
  const body = root.querySelector(`[data-table-body="${tableName}"]`);
  const rows = doc[tableName];

  rows.forEach((row, index) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="row-number">${index + 1}</td>
      <td><div class="editable table-edit" contenteditable="true" data-table="${tableName}" data-row="${index}" data-key="name"></div></td>
      <td class="qty-cell"><div class="editable table-edit" contenteditable="true" data-table="${tableName}" data-row="${index}" data-key="qty"></div></td>
      <td><div class="editable table-edit" contenteditable="true" data-table="${tableName}" data-row="${index}" data-key="note"></div></td>
    `;
    tr.querySelector('[data-key="name"]').textContent = row.name || "";
    tr.querySelector('[data-key="qty"]').textContent = row.qty || "";
    tr.querySelector('[data-key="note"]').textContent = row.note || "";
    body.appendChild(tr);
  });
}

function renderLines(root, doc) {
  const area = root.querySelector('[data-line-blocks-target="main"]');

  lineOrder.forEach((blockName) => {
    const block = document.createElement("section");
    block.className = "line-block";
    block.dataset.linesBlock = blockName;

    const heading = document.createElement("div");
    heading.className = "line-block-heading";

    const title = document.createElement("h3");
    title.textContent = lineTitles[blockName];
    heading.appendChild(title);

    const actions = document.createElement("div");
    actions.className = "line-actions no-print";
    actions.innerHTML = `
      <button type="button" data-action="add-line" data-lines-block="${blockName}">+ Додати рядок</button>
      <button type="button" data-action="remove-line" data-lines-block="${blockName}">- Відняти рядок</button>
    `;
    heading.appendChild(actions);
    block.appendChild(heading);

    const linesArea = document.createElement("div");
    linesArea.className = "lined-area";
    linesArea.dataset.lines = blockName;

    doc.lines[blockName].forEach((value, index) => {
      const line = document.createElement("div");
      line.className = "editable line-edit";
      line.contentEditable = "true";
      line.dataset.lines = blockName;
      line.dataset.lineIndex = String(index);
      line.textContent = value || "";
      linesArea.appendChild(line);
    });

    block.appendChild(linesArea);
    area.appendChild(block);
  });
}

function updateText(target) {
  const set = target.closest(".document-set");
  const doc = getDoc(set.dataset.docId);

  if (target.dataset.field) {
    doc.fields[target.dataset.field] = target.textContent;
    queueSave();
    if (target.closest(".service-page")) scheduleLayout();
    return;
  }

  if (target.dataset.table) {
    const row = doc[target.dataset.table][Number(target.dataset.row)];
    row[target.dataset.key] = target.textContent;
    queueSave();
    scheduleLayout();
    return;
  }

  if (target.dataset.lines) {
    doc.lines[target.dataset.lines][Number(target.dataset.lineIndex)] = target.textContent;
    queueSave();
    if (target.closest(".service-page")) scheduleLayout();
  }
}

function cleanPastedText(text, target) {
  let value = text
    .replace(/\u00a0/g, " ")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .trim();

  const shouldBeOneLine =
    target.dataset.table ||
    target.classList.contains("line-field") ||
    target.classList.contains("signature-line");

  if (shouldBeOneLine) {
    value = value.replace(/\s*\n+\s*/g, " ");
  }

  return value.replace(/[ \t]{2,}/g, " ");
}

function insertPlainText(target, text) {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || !target.contains(selection.anchorNode)) {
    target.textContent += text;
    moveCaretToEnd(target);
    return;
  }

  const range = selection.getRangeAt(0);
  range.deleteContents();
  const textNode = document.createTextNode(text);
  range.insertNode(textNode);
  range.setStartAfter(textNode);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

function moveCaretToEnd(target) {
  target.focus();
  const range = document.createRange();
  range.selectNodeContents(target);
  range.collapse(false);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
}

function addRow(doc, tableName) {
  doc[tableName].push({ name: "", qty: "", note: "" });
  render();
  queueSave();
}

function removeRow(doc, tableName) {
  if (doc[tableName].length <= 1) return;
  doc[tableName].pop();
  render();
  queueSave();
}

function addLine(doc, blockName) {
  if (!doc.lines[blockName]) return;
  doc.lines[blockName].push("");
  render();
  queueSave();
}

function removeLine(doc, blockName) {
  if (!doc.lines[blockName] || doc.lines[blockName].length <= 1) return;
  doc.lines[blockName].pop();
  render();
  queueSave();
}

documentsRoot.addEventListener("input", (event) => {
  const target = event.target;
  if (target.matches(".editable")) updateText(target);
});

documentsRoot.addEventListener("paste", (event) => {
  const target = event.target.closest(".editable");
  if (!target) return;

  event.preventDefault();
  const clipboardText = event.clipboardData?.getData("text/plain") || "";
  const text = cleanPastedText(clipboardText, target);
  insertPlainText(target, text);
  updateText(target);
});

documentsRoot.addEventListener("change", (event) => {
  const target = event.target;
  if (!target.matches("[data-check]")) return;

  const set = target.closest(".document-set");
  const doc = getDoc(set.dataset.docId);
  doc.fields[target.dataset.check] = target.checked;
  queueSave();
  scheduleLayout();
});

documentsRoot.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;

  const set = button.closest(".document-set");
  const doc = getDoc(set.dataset.docId);
  const action = button.dataset.action;

  if (action === "add-row") addRow(doc, button.dataset.table);
  if (action === "remove-row") removeRow(doc, button.dataset.table);
  if (action === "add-line") addLine(doc, button.dataset.linesBlock);
  if (action === "remove-line") removeLine(doc, button.dataset.linesBlock);
  if (action === "remove-document" && state.documents.length > 1) {
    state.documents = state.documents.filter((item) => item.id !== doc.id);
    render();
    queueSave();
  }
});

document.querySelector("#addDocumentBtn").addEventListener("click", () => {
  state.documents.push(createDocument());
  render();
  queueSave();
  documentsRoot.lastElementChild?.scrollIntoView({ behavior: "smooth", block: "start" });
});

document.querySelector("#printBtn").addEventListener("click", () => {
  window.print();
});

document.querySelector("#resetBtn").addEventListener("click", () => {
  const ok = window.confirm("Очистити всі анкети та повернути базовий шаблон?");
  if (!ok) return;

  state = { crmLink: "", documents: [createDocument()] };
  if (crmLinkInput) crmLinkInput.value = "";
  setCrmStatus("");
  localStorage.removeItem(STORAGE_KEY);
  render();
  queueSave();
});

if (crmLinkInput) {
  crmLinkInput.value = state.crmLink || "";
  crmLinkInput.addEventListener("input", () => {
    state.crmLink = crmLinkInput.value.trim();
    queueSave();
  });
  crmLinkInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      importCrmOrder();
    }
  });
}

crmImportButton?.addEventListener("click", importCrmOrder);

window.addEventListener("resize", scheduleLayout);
window.addEventListener("beforeprint", fitAllDocuments);

render();
