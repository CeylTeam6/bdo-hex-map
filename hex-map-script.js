// hex-map-script.js
// Firebase + Canvas + Boards + Characters (with video URL normalization + Storage upload)
// Requires Firebase SDK v11.9.0 modules in the HTML (as you already have)

// ================== IMPORTS ==================
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.9.0/firebase-app.js";
import {
  getAuth,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/11.9.0/firebase-auth.js";
import {
  getFirestore,
  doc,
  setDoc,
  getDoc,
  getDocs,
  collection,
  addDoc,
  deleteDoc,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/11.9.0/firebase-firestore.js";
import {
  getStorage,
  ref as sRef,
  uploadBytesResumable,
  getDownloadURL,
  deleteObject
} from "https://www.gstatic.com/firebasejs/11.9.0/firebase-storage.js";

// ================== FIREBASE CONFIG ==================
const firebaseConfig = {
  apiKey: "AIzaSyBlPghrv_E1KU-NOVysGKgPjkceGnKSQjQ",
  authDomain: "bdohexmap.firebaseapp.com",
  projectId: "bdohexmap",
  storageBucket: "bdohexmap.appspot.com",
  messagingSenderId: "196874353655",
  appId: "1:196874353655:web:b8dd232f20238b3febccf2",
  measurementId: "G-KHZS1LRC97"
};
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

// ================== GLOBAL STATE ==================
let isAdmin = false;
let hoveredHexKey = null;
let currentView = "hex"; // 'hex' | 'adventure' | 'business' | 'characters'
let currentOrderType = null;
let adventureRanks = { S: [], A: [], B: [], C: [], D: [], E: [] };

const REFERENCE_WIDTH = 2560;
const REFERENCE_HEIGHT = 1440;
const gridCols = 25;
const gridRows = 14;

// Capital UI/State (Hex)
let capitalMode = false; // toggled by button
let capitalRect = null;

// ================== HELPERS ==================
function getHexLayout() {
  const screenW = window.innerWidth;
  const screenH = window.innerHeight;
  const hexWidth = screenW / (gridCols + 0.5);
  const hexHeight = screenH / ((gridRows - 1) * 0.75 + 1);
  const hexSize = Math.min(hexWidth / Math.sqrt(3), hexHeight / 1.5);
  const pixelWidth = hexSize * Math.sqrt(3) * (gridCols + 0.5);
  const pixelHeight = hexSize * 1.5 * (gridRows - 1) + hexSize * 2;
  const offsetX = (screenW - pixelWidth) / 2 + hexSize;
  const offsetY = (screenH - pixelHeight) / 2 + hexSize;
  return { hexSize, offsetX, offsetY };
}

// Normalize common video links to direct video URLs
function normalizeVideoURL(url) {
  if (!url) return "";
  let u = url.trim();

  // Imgur variants
  // - If ends with .gifv -> .mp4
  // - If is i.imgur.com/<id> without extension -> add .mp4
  // - If is imgur.com/<id> (page) -> i.imgur.com/<id>.mp4
  try {
    const parsed = new URL(u);
    const host = parsed.hostname.toLowerCase();

    if (host.includes("imgur.com")) {
      // Convert page links to direct i.imgur.com
      // e.g. https://imgur.com/abcd -> https://i.imgur.com/abcd.mp4
      // e.g. https://i.imgur.com/abcd.gifv -> https://i.imgur.com/abcd.mp4
      let path = parsed.pathname.replace(/^\/+/, ""); // remove leading slash
      if (!path) return u;

      // Has extension?
      const hasExt = /\.\w{3,4}$/.test(path);
      if (hasExt && path.endsWith(".gifv")) {
        path = path.slice(0, -5) + ".mp4";
      } else if (!hasExt) {
        path = path + ".mp4";
      }
      return `https://i.imgur.com/${path}`;
    }

    // Giphy direct mp4?
    if (host.includes("giphy.com") && !u.endsWith(".mp4")) {
      // leave as-is; often needs a direct mp4/cdn link
      return u;
    }
  } catch {
    // If not a valid URL, just return it — maybe it's already a file path in Storage
    return u;
  }

  return u;
}

// Simple DOM helper
function el(id) { return document.getElementById(id); }

// ================== AUTH ==================
onAuthStateChanged(auth, user => {
  isAdmin = !!user;

  const adminChat = el("adminChat");
  if (adminChat) adminChat.style.display = isAdmin ? "block" : "none";

  const loginBox = el("loginBox");
  if (loginBox) loginBox.style.display = "block";

  refreshViewVisibility();
  updateRankUI();
  if (isAdmin) loadOrders();

  if (loginBox) {
    let badge = el("whoami");
    if (!badge) {
      badge = document.createElement("div");
      badge.id = "whoami";
      badge.style.marginTop = "6px";
      loginBox.appendChild(badge);
    }
    badge.textContent = isAdmin ? `Signed in: ${user.email || user.uid}` : "Not signed in";
  }
});

window.login = () => {
  const email = el("email").value;
  const password = el("password").value;
  signInWithEmailAndPassword(auth, email, password)
    .then(() => alert("Logged in!"))
    .catch(err => alert("Login error: " + err.message));
};
window.logout = () => { signOut(auth); alert("Logged out."); };

// ================== DROPDOWN SWITCHER ==================
let boardSelect = null;

function ensureCharactersOption() {
  boardSelect = el("boardSelect");
  if (!boardSelect) return;

  const dupes = Array.from(boardSelect.querySelectorAll('option[value="characters"]'));
  dupes.forEach((opt, idx) => { if (idx > 0) opt.remove(); });

  const exists = !!boardSelect.querySelector('option[value="characters"]');
  if (!exists) {
    const opt = document.createElement("option");
    opt.value = "characters";
    opt.textContent = "🧿 Character Directory";
    boardSelect.appendChild(opt);
  }
}

function handleBoardChange() {
  if (!boardSelect) return;
  const next = boardSelect.value;
  if (!next) return;
  currentView = next;

  const tip = el("tooltip");
  const lpanel = el("lordPanel");
  const advTip = el("advTooltip");
  if (tip) tip.style.display = "none";
  if (lpanel) lpanel.style.display = "none";
  if (advTip) advTip.style.display = "none";

  refreshViewVisibility();

  if (currentView === "adventure") {
    loadAdventureGrid().then(() => renderAdventureGrid());
  } else if (currentView === "hex") {
    render();
  } else if (currentView === "business") {
    renderBusinesses();
  } else if (currentView === "characters") {
    renderCharacterDirectory();
  }
}

function initBoardSelect() {
  ensureCharactersOption();
  boardSelect = el("boardSelect");
  if (!boardSelect) return;
  boardSelect.removeEventListener("change", handleBoardChange);
  boardSelect.addEventListener("change", handleBoardChange);
  boardSelect.value = currentView;
}

function showEl(id, on, asFlexForButtons = false) {
  const e = el(id);
  if (!e) return;
  e.style.display = on ? (asFlexForButtons ? "flex" : "block") : "none";
}

function refreshViewVisibility() {
  const inAdventureView = currentView === "adventure";
  const inHexView = currentView === "hex";
  const inBusinessView = currentView === "business";
  const inCharactersView = currentView === "characters";

  // Containers
  showEl("hexCanvasContainer", inHexView);
  showEl("adventureCanvasContainer", inAdventureView);
  showEl("businessContainer", inBusinessView);
  showEl("characterContainer", inCharactersView);

  // Button groups
  showEl("hexButtons", inHexView, true);
  showEl("adventureButtons", inAdventureView, true);
  showEl("businessButtons", inBusinessView, true);
  showEl("characterButtons", inCharactersView, true);

  // Hex-only admin controls (including capital buttons) — ensure ONLY HEX shows them
  const effectBtn = el("effectBtn");
  const clearEffectsBtn = el("clearEffectsBtn");
  const bulkBtn = el("bulkBtn");
  const dashboardBtn = el("dashboardBtn");
  const setCapitalBtn = el("setCapitalBtn");
  const clearCapitalBtn = el("clearCapitalBtn");

  if (effectBtn) effectBtn.style.display = isAdmin && inHexView ? "block" : "none";
  if (clearEffectsBtn) clearEffectsBtn.style.display = isAdmin && inHexView ? "block" : "none";
  if (bulkBtn) bulkBtn.style.display = isAdmin && inHexView ? "block" : "none";
  if (dashboardBtn) dashboardBtn.style.display = inHexView ? "block" : "none";
  if (setCapitalBtn) setCapitalBtn.style.display = isAdmin && inHexView ? "block" : "none";
  if (clearCapitalBtn) clearCapitalBtn.style.display = isAdmin && inHexView ? "block" : "none";

  // Wire capital buttons once
  if (setCapitalBtn && !setCapitalBtn._wired) {
    setCapitalBtn._wired = true;
    setCapitalBtn.addEventListener("click", () => {
      if (!isAdmin) return;
      capitalMode = !capitalMode;
      setCapitalBtn.style.background = capitalMode ? "#ffd77a" : "";
      clearCapitalBtn.style.background = "";
      if (capitalMode) {
        alert("Click a hex tile to set/unset it as Capital. You’ll be prompted for stats.");
      }
    });
  }
  if (clearCapitalBtn && !clearCapitalBtn._wired) {
    clearCapitalBtn._wired = true;
    clearCapitalBtn.addEventListener("click", async () => {
      if (!isAdmin) return;
      // Clear all capitals
      if (!confirm("Clear capital status from ALL tiles?")) return;
      for (let key in hexGrid) {
        if (hexGrid[key].capital && hexGrid[key].capital.isCapital) {
          hexGrid[key].capital = { isCapital: false, military: 0, economy: 0, agriculture: 0 };
          await setDoc(doc(db, "hexTiles", key), hexGrid[key]);
        }
      }
      render();
      alert("All capitals cleared.");
    });
  }

  resizeCanvas();

  if (inCharactersView) {
    ensureCharacterDOM();
    renderCharacterDirectory();
  }
}

// ================== ORDERS / REGISTRATION (Hex) ==================
window.submitOrder = (type) => {
  currentOrderType = type;
  el("orderPrompt").style.display = "block";
};
window.confirmOrder = async () => {
  const house = el("nobleHouseInput").value;
  const target = el("targetInput").value;
  let emoji;
  switch (currentOrderType) {
    case "attack": emoji = "⚔️"; break;
    case "defense": emoji = "🛡️"; break;
    case "economy": emoji = "📈"; break;
    case "spy": emoji = "🕵️"; break;
    case "sabotage": emoji = "💣"; break;
    case "diplomacy": emoji = "🕊️"; break;
    default: emoji = "❔";
  }
  const message = `${emoji} ${house} issues a ${currentOrderType.toUpperCase()} order targeting ${target}`;
  await addDoc(collection(db, "orders"), { type: currentOrderType, house, target, message, timestamp: Date.now() });
  el("orderPrompt").style.display = "none";
  el("nobleHouseInput").value = "";
  el("targetInput").value = "";
  if (isAdmin) loadOrders();
};
window.cancelOrder = () => el("orderPrompt").style.display = "none";

window.registerNobleHouse = () => el("registerPrompt").style.display = "block";
window.confirmRegistration = async () => {
  const family = el("familyNameInput").value;
  const domain = el("domainInput").value;
  const heraldry = el("heraldryInput").value;
  const message = `🏰 Noble House Registered:\nFamily: ${family}\nDomain: ${domain}\nHeraldry: ${heraldry}`;
  await addDoc(collection(db, "orders"), { type: "registration", house: family, target: domain, family, domain, heraldry, message, timestamp: Date.now() });
  el("registerPrompt").style.display = "none";
  el("familyNameInput").value = "";
  el("domainInput").value = "";
  el("heraldryInput").value = "";
  if (isAdmin) loadOrders();
};
window.cancelRegistration = () => el("registerPrompt").style.display = "none";

// ================== ADMIN LOG ==================
let highlightedOrders = [];
const hexGrid = {};
let hexEffects = {}; // { "q,r": true }

function syncHexEffectsWithGrid() {
  hexEffects = {};
  Object.entries(hexGrid).forEach(([key, tile]) => { if (tile.effect) hexEffects[key] = true; });
}
function highlightOrderTargets(orderData) {
  clearOrderHighlights();
  const keys = Object.keys(hexGrid);
  const targetMatch = keys.find(k => hexGrid[k].title && hexGrid[k].title.toLowerCase().includes(orderData.target ? orderData.target.toLowerCase() : ''));
  if (targetMatch) {
    const hex = hexGrid[targetMatch];
    highlightedOrders.push({ key: targetMatch, originalColor: hex.color });
    hex.color = "rgba(255, 0, 0, 0.5)";
  }
  render();
}
function clearOrderHighlights() {
  highlightedOrders.forEach(({ key, originalColor }) => { if (hexGrid[key]) hexGrid[key].color = originalColor; });
  highlightedOrders = [];
  render();
}
window.loadOrders = async () => {
  const list = el("orderList");
  list.innerHTML = "";
  const querySnapshot = await getDocs(collection(db, "orders"));
  querySnapshot.forEach(docSnap => {
    const data = docSnap.data();
    const li = document.createElement("li");
    li.textContent = `[${data.type}] ${data.message || `${data.house} -> ${data.target}`}`;
    li.style.cursor = "pointer";
    li.onclick = () => highlightOrderTargets(data);
    list.appendChild(li);
  });
};
window.clearOrders = async () => {
  const querySnapshot = await getDocs(collection(db, "orders"));
  querySnapshot.forEach(async docSnap => { await deleteDoc(doc(db, "orders", docSnap.id)); });
  el("orderList").innerHTML = "";
};

// ================== ADMIN & DASHBOARD (Hex) ==================
let effectMode = false;
let bulkMode = false;
let selectedHexes = [];
let bulkRect = null;
let bulkStart = null;

window.openDashboard = async function() {
  el("dashboardModal").style.display = "block";
  let houses = {};
  Object.values(hexGrid).forEach(hex => {
    if (hex.lord && hex.lord.trim()) {
      if (!houses[hex.lord]) houses[hex.lord] = { count: 0, domains: [], heraldry: "", info: "" };
      houses[hex.lord].count++;
      if (hex.title && hex.title.trim()) houses[hex.lord].domains.push(hex.title);
      if (hex.heraldry) houses[hex.lord].heraldry = hex.heraldry;
      if (hex.lordInfo) houses[hex.lord].info = hex.lordInfo;
    }
  });
  let html = Object.entries(houses).map(([lord, data]) => `
    <div style="border-bottom:1px solid #ccc; margin-bottom:12px; padding-bottom:9px;">
      <div style="font-weight:bold;">${lord}</div>
      <div style="margin-left:10px;">
        Domains: <span style="color:#888;">${data.domains.join(", ") || "None"}</span><br>
        Territories: <b>${data.count}</b>
        ${data.heraldry ? `<br>Heraldry: <img src="${data.heraldry}" style="height:32px;vertical-align:middle;">` : ""}
        ${data.info ? `<br><i>${data.info}</i>` : ""}
      </div>
    </div>
  `).join("");
  if (!html) html = "<i>No houses have been assigned to tiles yet.</i>";
  el("dashboardContent").innerHTML = html;
};
window.closeDashboard = () => el("dashboardModal").style.display = "none";

window.toggleEffectMode = function() {
  if (!isAdmin) return;
  effectMode = !effectMode;
  bulkMode = false;
  capitalMode = false;
  const eff = el("effectBtn");
  const bulk = el("bulkBtn");
  const setCapitalBtn = el("setCapitalBtn");
  if (eff) eff.style.background = effectMode ? "#ffd77a" : "";
  if (bulk) bulk.style.background = "";
  if (setCapitalBtn) setCapitalBtn.style.background = "";
  if (effectMode && Object.keys(hexEffects).length > 0) requestAnimationFrame(render);
};
window.clearAllHexEffects = async function() {
  if (!isAdmin) return;
  if (confirm("Clear all glowing hex effects?")) {
    for (let key in hexGrid) {
      if (hexGrid[key].effect) {
        hexGrid[key].effect = false;
        await setDoc(doc(db, "hexTiles", key), hexGrid[key]);
      }
    }
    syncHexEffectsWithGrid();
    render();
  }
};
window.toggleBulkMode = function() {
  if (!isAdmin) return;
  bulkMode = !bulkMode;
  effectMode = false;
  capitalMode = false;
  const bulk = el("bulkBtn");
  const eff = el("effectBtn");
  const setCapitalBtn = el("setCapitalBtn");
  if (bulk) bulk.style.background = bulkMode ? "#ffd77a" : "";
  if (eff) eff.style.background = "";
  if (setCapitalBtn) setCapitalBtn.style.background = "";
  selectedHexes = [];
  bulkRect = null;
  render();
};

// ================== HEX MAP ==================
const canvas = document.getElementById("hexMap");
const ctx = canvas.getContext("2d");
const background = new Image();
background.src = "BDOMAP.jpg?v=" + Date.now();

const tooltip = document.getElementById("tooltip");
const lordPanel = document.getElementById("lordPanel");
const lordName = document.getElementById("lordName");
const lordInfo = document.getElementById("lordInfo");
const lordVideo = document.getElementById("lordVideo");

function hexToPixel(q, r) {
  const { hexSize, offsetX, offsetY } = getHexLayout();
  const x = hexSize * Math.sqrt(3) * (q + r / 2) + offsetX;
  const y = hexSize * 1.5 * r + offsetY;
  return { x, y };
}
function pixelToHex(x, y) {
  const { hexSize, offsetX, offsetY } = getHexLayout();
  x -= offsetX; y -= offsetY;
  const q = ((Math.sqrt(3) / 3 * x) - (1 / 3 * y)) / hexSize;
  const r = (2 / 3 * y) / hexSize;
  return hexRound(q, r);
}
function hexRound(q, r) {
  let x = q, z = r, y = -x - z;
  let rx = Math.round(x), ry = Math.round(y), rz = Math.round(z);
  const x_diff = Math.abs(rx - x), y_diff = Math.abs(ry - y), z_diff = Math.abs(rz - z);
  if (x_diff > y_diff && x_diff > z_diff) rx = -ry - rz;
  else if (y_diff > z_diff) ry = -rx - rz;
  else rz = -rx - ry;
  return { q: rx, r: rz };
}

function render(timestamp = 0) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(background, 0, 0, canvas.width, canvas.height);

  const t = ((timestamp || performance.now()) / 900) % 2;
  const phase = t < 1 ? t : 2 - t;
  Object.entries(hexGrid).forEach(([key, { q, r, color, effect, capital }]) => {
    const { x, y } = hexToPixel(q, r);
    let isEffect = !!effect;
    let isSelected = selectedHexes.includes(key);
    let effectAlpha = isEffect ? 0.45 + 0.55 * phase : 0;
    drawHex(x, y, color, key, key === hoveredHexKey, isEffect, isSelected, effectAlpha, capital);
  });
  if (bulkRect) {
    ctx.save();
    ctx.strokeStyle = "#22fffd";
    ctx.lineWidth = 3.5;
    ctx.setLineDash([8, 10]);
    ctx.strokeRect(bulkRect.x1, bulkRect.y1, bulkRect.x2-bulkRect.x1, bulkRect.y2-bulkRect.y1);
    ctx.setLineDash([]);
    ctx.restore();
  }
  if (Object.keys(hexEffects).length > 0) requestAnimationFrame(render);
}

function drawHex(x, y, color = "rgba(0,0,0,0)", label = "", isHovered = false, isEffect = false, isSelected = false, effectAlpha = 1, capital = null) {
  const { hexSize } = getHexLayout();
  ctx.save();
  if (isEffect && effectAlpha > 0) {
    ctx.shadowColor = "#ffd77a";
    ctx.shadowBlur = 32 + 24 * effectAlpha;
    ctx.globalAlpha = effectAlpha;
  }
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const angle = Math.PI / 180 * (60 * i + 30);
    const px = x + hexSize * Math.cos(angle);
    const py = y + hexSize * Math.sin(angle);
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.strokeStyle = isHovered ? "yellow" : (isSelected ? "#5dff7a" : "rgba(0,0,0,0.7)");
  ctx.lineWidth = isHovered ? 4 : (isSelected ? 6 : 2);
  ctx.stroke();
  if (color !== "rgba(0,0,0,0)") { ctx.fillStyle = color; ctx.fill(); }
  ctx.shadowBlur = 0; ctx.globalAlpha = 1;

  // Label
  if (label) {
    ctx.fillStyle = "#000";
    ctx.font = "bold 16px 'Cinzel', serif";
    ctx.textAlign = "center";
    ctx.fillText(label, x, y + 5);
  }

  // Capital badge
  if (capital && capital.isCapital) {
    ctx.beginPath();
    ctx.arc(x, y - hexSize * 0.55, 10, 0, Math.PI * 2);
    ctx.fillStyle = "#ffd700";
    ctx.fill();
    ctx.strokeStyle = "#603";
    ctx.stroke();
  }

  ctx.restore();
}

// Click handlers (hex)
canvas.addEventListener("click", async (e) => {
  if (!isAdmin) return alert("You must be logged in to edit.");
  const rect = canvas.getBoundingClientRect();
  const mouseX = e.clientX - rect.left;
  const mouseY = e.clientY - rect.top;
  const { q, r } = pixelToHex(mouseX, mouseY);
  const key = `${q},${r}`;
  let data = hexGrid[key] || {
    q, r, color: "rgba(0,0,0,0)", title: "Untitled", info: "", image: "",
    lord: "", lordInfo: "", lordVideo: "", effect: false, heraldry: "",
    capital: { isCapital: false, military: 0, economy: 0, agriculture: 0 }
  };

  // Clear tile (single)
  if (window.clearHexMode) {
    await setDoc(doc(db, "hexTiles", key), {
      q, r, color: "rgba(0,0,0,0)", title: "", info: "", image: "",
      lord: "", lordInfo: "", lordVideo: "", effect: false, heraldry: "",
      capital: { isCapital: false, military: 0, economy: 0, agriculture: 0 }
    });
    hexGrid[key] = {
      q, r, color: "rgba(0,0,0,0)", title: "", info: "", image: "",
      lord: "", lordInfo: "", lordVideo: "", effect: false, heraldry: "",
      capital: { isCapital: false, military: 0, economy: 0, agriculture: 0 }
    };
    syncHexEffectsWithGrid();
    window.clearHexMode = false;
    render(); return;
  }

  // Tile effect toggle
  if (effectMode && isAdmin) {
    data.effect = !!data.effect ? false : true;
    hexGrid[key] = data;
    await setDoc(doc(db, "hexTiles", key), data);
    syncHexEffectsWithGrid();
    if (Object.keys(hexEffects).length > 0) requestAnimationFrame(render); else render();
    return;
  }

  // Capital set/unset
  if (capitalMode && isAdmin) {
    const wasCapital = data.capital && data.capital.isCapital;
    const nextIsCapital = !wasCapital;

    let military = 0, economy = 0, agriculture = 0;
    if (nextIsCapital) {
      const m = prompt("Capital MILITARY (0–5):", String(data.capital?.military ?? 0));
      const e2 = prompt("Capital ECONOMY (0–5):", String(data.capital?.economy ?? 0));
      const a = prompt("Capital AGRICULTURE (0–5):", String(data.capital?.agriculture ?? 0));
      military = Math.max(0, Math.min(5, Number(m || 0)));
      economy = Math.max(0, Math.min(5, Number(e2 || 0)));
      agriculture = Math.max(0, Math.min(5, Number(a || 0)));
    }

    data.capital = { isCapital: nextIsCapital, military, economy, agriculture };
    hexGrid[key] = data;
    await setDoc(doc(db, "hexTiles", key), data);
    render();
    return;
  }

  if (bulkMode) return; // don’t open prompts while bulk-selecting

  // Regular edit
  const title = prompt("Enter title:", data.title);
  const info = prompt("Enter description:", data.info);
  const image = prompt("Enter image URL:", data.image);
  const color = prompt("Enter hex color (e.g. rgba(0,255,0,0.5)):", data.color);
  const lord = prompt("Enter Lord's Name:", data.lord);
  const lordInfoText = prompt("Enter Lord's Info:", data.lordInfo);
  const lordVideoURL = prompt("Enter Lord's Video URL:", data.lordVideo);
  const heraldry = prompt("Heraldry image URL (optional):", data.heraldry || "");

  data = {
    q, r, title, info, image, color, lord, lordInfo: lordInfoText,
    lordVideo: normalizeVideoURL(lordVideoURL || ""),
    effect: data.effect || false,
    heraldry: heraldry || "",
    capital: data.capital || { isCapital: false, military: 0, economy: 0, agriculture: 0 }
  };
  hexGrid[key] = data;
  await setDoc(doc(db, "hexTiles", key), data);
  syncHexEffectsWithGrid();
  render();
});
window.clearHexTile = () => { window.clearHexMode = true; alert("Click a hex to clear it."); };

canvas.addEventListener("mousemove", (e) => {
  const rect = canvas.getBoundingClientRect();
  const mouseX = e.clientX - rect.left;
  const mouseY = e.clientY - rect.top;
  const { q, r } = pixelToHex(mouseX, mouseY);
  const key = `${q},${r}`;
  hoveredHexKey = key;
  const hex = hexGrid[key];

  if (hex && (hex.title || hex.info || hex.image)) {
    lordPanel.style.display = "block";
    lordPanel.style.left = `${e.clientX + 10}px`;
    lordPanel.style.top = `${e.clientY - 205}px`;
    lordName.textContent = hex.lord || "Unknown Lord";
    lordInfo.textContent = hex.lordInfo || "";

    // Play video safely with normalization
    lordVideo.src = normalizeVideoURL(hex.lordVideo || "");
    lordVideo.loop = true; lordVideo.muted = true; lordVideo.playsInline = true;
    lordVideo.autoplay = true;
    lordVideo.play().catch(() => { /* ignore */ });

    tooltip.style.display = "block";
    tooltip.style.left = `${e.clientX + 10}px`;
    tooltip.style.top = `${e.clientY + 35}px`;
    tooltip.innerHTML = `<strong>${hex.title}</strong><br>${hex.info}` + (hex.image ? `<br><img src="${hex.image}" style="width:100px;">` : "");
  } else {
    tooltip.style.display = "none";
    lordPanel.style.display = "none";
    lordVideo.pause();
  }
  render();
});

/* Bulk select events */
canvas.addEventListener("mousedown", (e) => {
  if (!isAdmin || !bulkMode) return;
  const rect = canvas.getBoundingClientRect();
  const mouseX = e.clientX - rect.left;
  const mouseY = e.clientY - rect.top;
  bulkStart = { x: mouseX, y: mouseY };
  bulkRect = null;
});
canvas.addEventListener("mousemove", (e) => {
  if (!isAdmin || !bulkMode || !bulkStart) return;
  const rect = canvas.getBoundingClientRect();
  const mouseX = e.clientX - rect.left;
  const mouseY = e.clientY - rect.top;
  bulkRect = {
    x1: Math.min(bulkStart.x, mouseX),
    y1: Math.min(bulkStart.y, mouseY),
    x2: Math.max(bulkStart.x, mouseX),
    y2: Math.max(bulkStart.y, mouseY)
  };
  render();
});
canvas.addEventListener("mouseup", (e) => {
  if (!isAdmin || !bulkMode || !bulkStart) return;
  const rect = canvas.getBoundingClientRect();
  const mouseX = e.clientX - rect.left;
  const mouseY = e.clientY - rect.top;
  bulkRect = {
    x1: Math.min(bulkStart.x, mouseX),
    y1: Math.min(bulkStart.y, mouseY),
    x2: Math.max(bulkStart.x, mouseX),
    y2: Math.max(bulkStart.y, mouseY)
  };
  selectedHexes = [];
  for (let key in hexGrid) {
    let { q, r } = hexGrid[key];
    let { x, y } = hexToPixel(q, r);
    if (x >= bulkRect.x1 && x <= bulkRect.x2 && y >= bulkRect.y1 && y <= bulkRect.y2) selectedHexes.push(key);
  }
  bulkStart = null;
  showBulkModal();
  render();
});

async function loadGrid() {
  const snap = await getDocs(collection(db, "hexTiles"));
  snap.forEach(docSnap => {
    const data = docSnap.data();
    // ensure capital object exists
    if (!data.capital) data.capital = { isCapital: false, military: 0, economy: 0, agriculture: 0 };
    hexGrid[`${data.q},${data.r}`] = data;
  });
  syncHexEffectsWithGrid();
  render();
  if (Object.keys(hexEffects).length > 0) requestAnimationFrame(render);
}

function showBulkModal() { const m = el("bulkModal"); if (m) m.style.display = "block"; }
window.closeBulkModal = function() {
  const m = el("bulkModal");
  if (m) m.style.display = "none";
  selectedHexes = [];
  bulkRect = null;
  render();
};
window.bulkAssignHouse = async function() {
  let lord = prompt("Enter Lord/House name for selected hexes:");
  if (lord) {
    for (let key of selectedHexes) {
      let h = hexGrid[key];
      h.lord = lord;
      await setDoc(doc(db, "hexTiles", key), h);
    }
    await loadGrid();
    closeBulkModal();
  }
};
window.bulkColor = async function() {
  let color = prompt("Enter color (e.g. rgba(0,255,0,0.5)) for selected hexes:");
  if (color) {
    for (let key of selectedHexes) {
      let h = hexGrid[key];
      h.color = color;
      await setDoc(doc(db, "hexTiles", key), h);
    }
    await loadGrid();
    closeBulkModal();
  }
};
window.bulkClear = async function() {
  if (confirm("Clear ALL selected hexes?")) {
    for (let key of selectedHexes) {
      let { q, r } = hexGrid[key];
      let h = { q, r, color: "rgba(0,0,0,0)", title: "", info: "", image: "", lord: "", lordInfo: "", lordVideo: "", effect: false, heraldry: "", capital: { isCapital: false, military: 0, economy: 0, agriculture: 0 } };
      await setDoc(doc(db, "hexTiles", key), h);
      hexGrid[key] = h;
    }
    await loadGrid();
    closeBulkModal();
  }
};

// ================== ADVENTURE GRID ==================
const adventureCanvas = document.getElementById("adventureGrid");
const actx = adventureCanvas.getContext("2d");
const advBg = new Image();
advBg.src = "adventure.jpg";
let adventureGrid = {};
let advHover = null;
let adventureBgLoaded = false;
const advGridCols = 7;
const advGridRows = 7;
advBg.onload = () => { adventureBgLoaded = true; renderAdventureGrid(); };

function getAdventureGridLayout() {
  const padding = 40;
  const usableW = window.innerWidth - padding * 2;
  const usableH = window.innerHeight - padding * 2;
  const cellSize = Math.min(usableW / advGridCols, usableH / advGridRows);
  const gridWidth = cellSize * advGridCols;
  const gridHeight = cellSize * advGridRows;
  const offsetX = (window.innerWidth - gridWidth) / 2;
  const offsetY = (window.innerHeight - gridHeight) / 2;
  return { cellSize, offsetX, offsetY };
}
function renderAdventureGrid() {
  actx.clearRect(0, 0, adventureCanvas.width, adventureCanvas.height);
  if (adventureBgLoaded) actx.drawImage(advBg, 0, 0, adventureCanvas.width, adventureCanvas.height);
  else { actx.fillStyle = "#ccc"; actx.fillRect(0, 0, adventureCanvas.width, adventureCanvas.height); }
  const { cellSize, offsetX, offsetY } = getAdventureGridLayout();
  for (let r = 0; r < advGridRows; r++) {
    for (let c = 0; c < advGridCols; c++) {
      const key = `${c},${r}`;
      const cell = adventureGrid[key] || {};
      const x = offsetX + c * cellSize;
      const y = offsetY + r * cellSize;
      actx.fillStyle = cell.color || "rgba(255,255,255,0.3)";
      actx.fillRect(x, y, cellSize, cellSize);
      actx.strokeStyle = "black"; actx.lineWidth = 1.5; actx.strokeRect(x, y, cellSize, cellSize);
    }
  }
  if (advHover) {
    const { cellSize, offsetX, offsetY } = getAdventureGridLayout();
    const { c, r } = advHover;
    const x = offsetX + c * cellSize, y = offsetY + r * cellSize;
    actx.save(); actx.strokeStyle = "yellow"; actx.lineWidth = 4; actx.strokeRect(x, y, cellSize, cellSize); actx.restore();
  }
}
adventureCanvas.addEventListener("click", async (e) => {
  if (!isAdmin) return;
  const { cellSize, offsetX, offsetY } = getAdventureGridLayout();
  const rect = adventureCanvas.getBoundingClientRect();
  const mouseX = e.clientX - rect.left; const mouseY = e.clientY - rect.top;
  const c = Math.floor((mouseX - offsetX) / cellSize);
  const r = Math.floor((mouseY - offsetY) / cellSize);
  if (c < 0 || r < 0 || c >= advGridCols || r >= advGridRows) return;
  const key = `${c},${r}`;
  const existing = adventureGrid[key] || {};
  const type = prompt("Enter Mission Type:", existing.type || "");
  const details = prompt("Enter Mission Details:", existing.details || "");
  const image = prompt("Enter Image URL:", existing.image || "");
  const color = "rgba(0,255,0,0.2)";
  adventureGrid[key] = { type, details, image, color };
  await setDoc(doc(db, "adventureGrid", key), { ...adventureGrid[key], c, r });
  renderAdventureGrid();
});
window.clearAdventureTile = () => { window.clearAdventureMode = true; alert("Click an adventure box to clear it."); };
adventureCanvas.addEventListener("mousedown", async (e) => {
  if (!isAdmin || !window.clearAdventureMode) return;
  const { cellSize, offsetX, offsetY } = getAdventureGridLayout();
  const rect = adventureCanvas.getBoundingClientRect();
  const mouseX = e.clientX - rect.left; const mouseY = e.clientY - rect.top;
  const c = Math.floor((mouseX - offsetX) / cellSize); const r = Math.floor((mouseY - offsetY) / cellSize);
  if (c < 0 || r < 0 || c >= advGridCols || r >= advGridRows) return;
  const key = `${c},${r}`;
  adventureGrid[key] = {};
  await setDoc(doc(db, "adventureGrid", key), { c, r, type: "", details: "", image: "", color: "" });
  window.clearAdventureMode = false;
  renderAdventureGrid();
});
adventureCanvas.addEventListener("mousemove", (e) => {
  const { cellSize, offsetX, offsetY } = getAdventureGridLayout();
  const rect = adventureCanvas.getBoundingClientRect();
  const mouseX = e.clientX - rect.left; const mouseY = e.clientY - rect.top;
  const c = Math.floor((mouseX - offsetX) / cellSize); const r = Math.floor((mouseY - offsetY) / cellSize);
  if (c < 0 || r < 0 || c >= advGridCols || r >= advGridRows) {
    advHover = null; const t = el("advTooltip"); if (t) t.style.display = "none"; renderAdventureGrid(); return;
  }
  advHover = { c, r }; renderAdventureGrid();
  const key = `${c},${r}`; const cell = adventureGrid[key];
  const advTooltip = el("advTooltip");
  if (cell && (cell.type || cell.details || cell.image)) {
    if (advTooltip) {
      advTooltip.style.display = "block";
      advTooltip.style.left = (e.clientX + 15) + "px";
      advTooltip.style.top = (e.clientY + 25) + "px";
      advTooltip.innerHTML =
        `<strong>${cell.type || "Unknown Mission"}</strong><br>` +
        (cell.details ? cell.details + "<br>" : "") +
        (cell.image ? `<img src="${cell.image}" style="width:90px; margin-top:5px;">` : "");
    }
  } else {
    if (advTooltip) advTooltip.style.display = "none";
  }
});
async function loadAdventureGrid() {
  adventureGrid = {};
  const snap = await getDocs(collection(db, "adventureGrid"));
  snap.forEach(docSnap => { const data = docSnap.data(); adventureGrid[`${data.c},${data.r}`] = data; });
}

// ================== ADVENTURE RANKS ==================
async function loadRanks() {
  const docSnap = await getDoc(doc(db, "adventureRanks", "ranks"));
  if (docSnap.exists()) { adventureRanks = docSnap.data(); updateRankUI(); }
}
async function saveRanks() { await setDoc(doc(db, "adventureRanks", "ranks"), adventureRanks); }
window.assignRank = async (rank) => {
  if (!isAdmin) return;
  const name = prompt(`Enter name for ${rank} rank:`);
  if (name) { adventureRanks[rank].push(name); await saveRanks(); updateRankUI(); }
};
window.removeRankName = async (rank) => {
  if (!isAdmin) return;
  const name = prompt(`Enter the name to remove from ${rank} rank:`);
  if (name) {
    const idx = adventureRanks[rank].findIndex(n => n.toLowerCase() === name.trim().toLowerCase());
    if (idx !== -1) { adventureRanks[rank].splice(idx, 1); await saveRanks(); updateRankUI(); alert(`Removed "${name}" from rank ${rank}.`); }
    else alert(`Name not found in rank ${rank}.`);
  }
};
window.clearAllRank = async (rank) => {
  if (!isAdmin) return;
  if (confirm(`Clear ALL names from ${rank} rank?`)) { adventureRanks[rank] = []; await saveRanks(); updateRankUI(); }
};
function updateRankUI() {
  for (const rank of ["S", "A", "B", "C", "D", "E"]) {
    const e = el(`rank${rank}`);
    if (!e) continue;
    e.textContent = adventureRanks[rank] ? adventureRanks[rank].join(", ") : "";
    const addBtn = el(`addRank${rank}`);
    const remBtn = el(`removeRank${rank}`);
    const clrBtn = el(`clearRank${rank}`);
    if (isAdmin) {
      if (addBtn) addBtn.style.display = "inline";
      if (remBtn) remBtn.style.display = "inline";
      if (clrBtn) clrBtn.style.display = "inline";
    } else {
      if (addBtn) addBtn.style.display = "none";
      if (remBtn) remBtn.style.display = "none";
      if (clrBtn) clrBtn.style.display = "none";
    }
  }
}

// ================== RESIZE ==================
function resizeCanvas() {
  if (canvas) { canvas.width = window.innerWidth; canvas.height = window.innerHeight; }
  if (adventureCanvas) { adventureCanvas.width = window.innerWidth; adventureCanvas.height = window.innerHeight; }
  if (currentView === "hex") render();
  if (currentView === "adventure") renderAdventureGrid();
  if (Object.keys(hexEffects).length > 0) requestAnimationFrame(render);
  if (currentView === "characters") drawCharacterChart();
}
window.addEventListener("resize", resizeCanvas);

// ================== BUSINESS BOARD ==================
let businesses = [];
let editingBusiness = null;
let unsubscribeBusinesses = null;

function showAdminWriteError(err) {
  console.error(err);
  if (!auth.currentUser) {
    alert(
      "Editing the Business Board requires your admin login (the same login used on the other boards). " +
      "Please log in and try again."
    );
  } else if (err && err.code === "permission-denied") {
    alert(
      "Permission denied by Firestore rules. Your admin account is logged in, " +
      "but the rules for the Business Board don't allow this write. " +
      "Update your Firestore rules to allow logged-in admins to write to /businesses and try again."
    );
  } else {
    alert("Could not complete the action. " + (err?.message || "Unknown error"));
  }
}

async function loadBusinesses() {
  if (unsubscribeBusinesses) unsubscribeBusinesses();
  const colRef = collection(db, "businesses");
  unsubscribeBusinesses = onSnapshot(colRef, (snap) => {
    businesses = [];
    snap.forEach(docSnap => {
      const data = docSnap.data();
      businesses.push({
        id: docSnap.id,
        name: "",
        owner: "",
        description: "",
        location: "",
        hours: "",
        logoURL: "",
        inventory: [],
        ...data
      });
    });
    renderBusinesses();
  }, (err) => {
    console.error("Business snapshot error:", err);
    alert("Could not load businesses: " + err.message);
  });
}

function renderBusinesses() {
  const grid = el("businessGrid");
  if (!grid) return;
  grid.innerHTML = "";
  if (!businesses.length) {
    grid.innerHTML = `<div style="color:#e8d8b8;opacity:.9;">No businesses registered yet. Be the first to open shop!</div>`;
    return;
  }
  businesses.forEach((biz) => {
    const card = document.createElement("div");
    card.className = "bizCard";
    card.innerHTML = `
      <div class="bizHeader">
        <img class="bizLogo" src="${biz.logoURL || ''}" onerror="this.style.display='none'">
        <div class="bizTitle">${biz.name || 'Unnamed Business'}</div>
      </div>
      <div class="bizField"><b>Owner:</b> ${biz.owner || '—'}</div>
      <div class="bizField"><b>Location:</b> ${biz.location || '—'}</div>
      <div class="bizField"><b>Hours:</b> ${biz.hours || '—'}</div>
      <div class="bizField"><b>About:</b> ${biz.description || '—'}</div>
      <div class="invHeader">📜 Inventory</div>
      <ul class="invList">
        ${(biz.inventory && biz.inventory.length) ? biz.inventory.map((it)=>`<li>${it.item} — ${it.price}${(it.stock!==undefined&&it.stock!=="")?` (x${it.stock})`:''}</li>`).join("") : `<li style="opacity:.8;">No items listed.</li>`}
      </ul>
      <div class="bizActions">
        <button onclick="openMeetingPrompt('${biz.id}')">🤝 Request Meeting</button>
        ${isAdmin ? `<button onclick="openEditBusiness('${biz.id}')">✏️ Edit</button>` : ""}
      </div>
    `;
    const invHeader = card.querySelector(".invHeader");
    const invList = card.querySelector(".invList");
    invHeader.addEventListener("click", () => {
      invList.style.display = (invList.style.display === "block") ? "none" : "block";
    });
    grid.appendChild(card);
  });
}

// Business registration/editing functions … (unchanged from your last working version)
window.openBusinessPrompt = () => {
  el("bizNameInput").value = "";
  el("bizOwnerInput").value = "";
  el("bizDescInput").value = "";
  el("bizLocInput").value = "";
  el("bizHoursInput").value = "";
  el("bizLogoInput").value = "";
  el("businessPrompt").style.display = "block";
};
window.closeBusinessPrompt = () => el("businessPrompt").style.display = "none";
window.confirmBusinessRegistration = async () => {
  const name = el("bizNameInput").value.trim();
  const owner = el("bizOwnerInput").value.trim();
  const description = el("bizDescInput").value.trim();
  const location = el("bizLocInput").value.trim();
  const hours = el("bizHoursInput").value.trim();
  const logoURL = el("bizLogoInput").value.trim();

  if (!name) return alert("Please enter a business name.");

  try {
    await addDoc(collection(db, "businesses"), {
      name, owner, description, location, hours, logoURL, inventory: []
    });

    try {
      await addDoc(collection(db, "orders"), {
        type: "business",
        house: owner || name,
        target: name,
        message: `🏪 Business Registered: ${name} (${owner || "Unknown Owner"})`,
        timestamp: Date.now()
      });
    } catch (_) {}

    el("businessPrompt").style.display = "none";
    if (isAdmin) loadOrders();
  } catch (err) {
    console.error("Registration failed:", err);
    if (!auth.currentUser) {
      alert("Please log in with your admin account to edit the Business Board and try again.");
    } else if (err && err.code === "permission-denied") {
      alert(
        "Permission denied by Firestore rules for Business registration. " +
        "Update your rules so logged-in admins can create in /businesses."
      );
    } else {
      alert("Could not register the business. " + (err?.message || "Unknown error"));
    }
  }
};
window.openEditBusiness = (id) => {
  if (!isAdmin) { alert("Admin login required to edit businesses."); return; }
  editingBusiness = businesses.find(b => b.id === id);
  if (!editingBusiness) return;
  el("editBizId").value = editingBusiness.id;
  el("editBizName").value = editingBusiness.name || "";
  el("editBizOwner").value = editingBusiness.owner || "";
  el("editBizDesc").value = editingBusiness.description || "";
  el("editBizLoc").value = editingBusiness.location || "";
  el("editBizHours").value = editingBusiness.hours || "";
  el("editBizLogo").value = editingBusiness.logoURL || "";
  const ul = el("invListEditor");
  ul.innerHTML = (editingBusiness.inventory && editingBusiness.inventory.length)
    ? editingBusiness.inventory.map((it, idx) => `<li>${it.item} — ${it.price} ${it.stock!==undefined&&it.stock!==""?`(x${it.stock})`:""} <button onclick="removeInventoryItem(${idx})" style="margin-left:6px;">Remove</button></li>`).join("")
    : `<li style="opacity:.8;">No items listed.</li>`;
  el("editBusinessPrompt").style.display = "block";
};
window.closeEditBusinessPrompt = () => {
  el("editBusinessPrompt").style.display = "none";
  editingBusiness = null;
};
window.saveBusinessEdits = async () => {
  if (!isAdmin) { alert("Admin login required to edit businesses."); return; }
  if (!editingBusiness) return;
  try {
    editingBusiness.name = el("editBizName").value.trim();
    editingBusiness.owner = el("editBizOwner").value.trim();
    editingBusiness.description = el("editBizDesc").value.trim();
    editingBusiness.location = el("editBizLoc").value.trim();
    editingBusiness.hours = el("editBizHours").value.trim();
    editingBusiness.logoURL = el("editBizLogo").value.trim();
    await setDoc(doc(db, "businesses", editingBusiness.id), editingBusiness);
    closeEditBusinessPrompt();
  } catch (err) { showAdminWriteError(err); }
};
window.deleteBusiness = async () => {
  if (!isAdmin) { alert("Admin login required to delete businesses."); return; }
  if (!editingBusiness) return;
  if (!confirm(`Delete ${editingBusiness.name}?`)) return;
  try {
    await deleteDoc(doc(db, "businesses", editingBusiness.id));
    closeEditBusinessPrompt();
  } catch (err) { showAdminWriteError(err); }
};
window.addInventoryItem = async () => {
  if (!isAdmin) { alert("Admin login required to edit inventory."); return; }
  if (!editingBusiness) return;
  const item = el("invItemName").value.trim();
  const price = el("invItemPrice").value.trim();
  const stock = el("invItemStock").value.trim();
  if (!item) return alert("Item name required");
  try {
    if (!editingBusiness.inventory) editingBusiness.inventory = [];
    editingBusiness.inventory.push({ item, price, stock });
    await setDoc(doc(db, "businesses", editingBusiness.id), editingBusiness);
    openEditBusiness(editingBusiness.id);
  } catch (err) { showAdminWriteError(err); }
};
window.removeInventoryItem = async (idx) => {
  if (!isAdmin) { alert("Admin login required to edit inventory."); return; }
  if (!editingBusiness) return;
  try {
    editingBusiness.inventory.splice(idx, 1);
    await setDoc(doc(db, "businesses", editingBusiness.id), editingBusiness);
    openEditBusiness(editingBusiness.id);
  } catch (err) { showAdminWriteError(err); }
};
window.openMeetingPrompt = (businessId) => {
  el("meetBusinessId").value = businessId;
  el("meetRequesterInput").value = "";
  el("meetMessageInput").value = "";
  el("meetingPrompt").style.display = "block";
};
window.openMeetingPromptGeneral = () => {
  const name = prompt("Which business would you like to meet with?");
  if (!name) return;
  const biz = businesses.find(b => (b.name||"").toLowerCase() === name.toLowerCase());
  if (!biz) return alert("Business not found. Please click 'Request Meeting' on a business card instead.");
  openMeetingPrompt(biz.id);
};
window.closeMeetingPrompt = () => el("meetingPrompt").style.display = "none";
window.confirmMeetingRequest = async () => {
  const businessId = el("meetBusinessId").value;
  const requester = el("meetRequesterInput").value.trim();
  const message = el("meetMessageInput").value.trim();
  if (!businessId || !requester || !message) return alert("Please fill out all fields.");

  try {
    await addDoc(collection(db, "meetingRequests"), {
      businessId, requester, message, timestamp: Date.now()
    });

    try {
      const biz = businesses.find(b => b.id === businessId);
      const logMsg = `🤝 Meeting Request: ${requester} → ${biz ? biz.name : businessId} — "${message}"`;
      await addDoc(collection(db, "orders"), {
        type: "meeting",
        house: requester,
        target: biz ? biz.name : businessId,
        message: logMsg,
        timestamp: Date.now()
      });
    } catch (_) {}

    el("meetingPrompt").style.display = "none";
    if (isAdmin) loadOrders();
  } catch (err) {
    console.error("Meeting request failed:", err);
    alert("Could not send meeting request. Please try again shortly.");
  }
};

// ================== CHARACTER DIRECTORY ==================
let characters = []; // see shape in subscribeCharacters
let selectedCharacterId = null;
let unsubscribeCharacters = null;

// DOM creation (Character page)
function ensureCharacterDOM() {
  if (document.getElementById("characterContainer")) return;

  const cont = document.createElement("div");
  cont.id = "characterContainer";
  cont.style.cssText = `
    position:absolute; inset:0; display:none; z-index:0;
    background: radial-gradient(1200px 800px at 20% 20%, #3b2c1c 0%, #20160e 45%, #120c08 100%),
                url('business.jpg') center/cover no-repeat fixed;
  `;

  const overlay = document.createElement("div");
  overlay.style.cssText = `
    position:absolute; inset:0;
    background: radial-gradient(circle at 50% 50%, #00000033, #000000bb);
    pointer-events:none;
  `;
  cont.appendChild(overlay);

  const wrap = document.createElement("div");
  wrap.id = "charWrap";
  wrap.style.cssText = `
    position:absolute; left:50%; top:58%; transform:translate(-50%,-50%);
    width:min(1400px, 92vw); height:min(76vh, 780px);
    display:grid; grid-template-columns: 1.1fr 0.9fr; gap:16px;
    border:2px solid #d2a85c; border-radius:16px; padding:28px 16px 16px 16px;
    background:#24170ee6; box-shadow:0 14px 48px #000a; color:#f8eacc;
    overflow:hidden;
  `;

  const left = document.createElement("div");
  left.id = "charLeft";
  left.style.cssText = "display:flex; flex-direction:column; gap:10px; overflow:auto;";

  const ctrl = document.createElement("div");
  ctrl.style.cssText = "display:flex; gap:10px; align-items:center; flex-wrap:wrap; margin-top:6px;";
  ctrl.innerHTML = `
    <button id="charRegisterBtn" style="background:#d2a85c; color:#222; border:none; border-radius:10px; padding:7px 12px; cursor:pointer;">
      ✨ Register Character
    </button>
    <button id="charEditBtn" style="background:#9fc4ff; color:#10223a; border:none; border-radius:10px; padding:7px 12px; cursor:pointer; display:none;">
      ✏️ Edit Selected
    </button>
    <button id="charAdminDeleteBtn" style="background:#c95c5c; color:#fff; border:none; border-radius:10px; padding:7px 12px; cursor:pointer; display:none;">
      🗑️ Admin Delete
    </button>
    <span style="margin-left:6px; opacity:.9;">View:</span>
    <select id="charPicker" style="background:#2b2115; color:#ffd77a; border:1px solid #a97b36; border-radius:10px; padding:6px 12px;">
      <option value="">— Select Character —</option>
    </select>
  `;
  left.appendChild(ctrl);

  const details = document.createElement("div");
  details.id = "charDetails";
  details.style.cssText = `
    flex:1; overflow:auto; background:#3b2b1a; border:2px solid #a97b36;
    border-radius:12px; padding:18px 12px 12px 12px; line-height:1.4; box-shadow: inset 0 0 24px #0007;
    margin-top:6px;
  `;
  details.innerHTML = `<div style="opacity:.85;">Select a character from the dropdown to view their story.</div>`;
  left.appendChild(details);

  const right = document.createElement("div");
  right.id = "charRight";
  right.style.cssText = "display:flex; flex-direction:column; gap:10px; overflow:hidden;";

  const nameHdr = document.createElement("div");
  nameHdr.id = "charNameHdr";
  nameHdr.style.cssText = `
    font-family:'Cinzel',serif; font-size:28px; font-weight:800; text-align:center;
    color:#ffe7ad; text-shadow:0 2px 0 #3a2b1a, 0 0 14px #000;
    letter-spacing:.5px; padding:6px 8px; border-bottom:1px solid #a97b36;
    min-height:42px;
  `;
  nameHdr.textContent = "Character Directory";
  right.appendChild(nameHdr);

  const videoWrap = document.createElement("div");
  videoWrap.style.cssText = `
    display:flex; justify-content:center; align-items:center;
    background:#120c08; border:2px solid #a97b36; border-radius:12px;
    padding:10px; height:38%;
  `;
  videoWrap.innerHTML = `
    <video id="charVideo" playsinline muted loop autoplay style="width:100%; max-width:560px; height:100%; object-fit:cover; border-radius:10px; background:#000;"></video>
  `;
  right.appendChild(videoWrap);

  const chartWrap = document.createElement("div");
  chartWrap.style.cssText = `
    flex:1; background:#120c08; border:2px solid #a97b36; border-radius:12px; padding:12px;
    display:flex; flex-direction:column; overflow:hidden;
  `;
  const chartTitle = document.createElement("div");
  chartTitle.style.cssText = "font-weight:700; margin-bottom:6px; color:#ffe4a6;";
  chartTitle.textContent = "Comparative Stats";
  const chartCanvas = document.createElement("canvas");
  chartCanvas.id = "charChart";
  chartCanvas.width = 640;
  chartCanvas.height = 260;
  chartWrap.appendChild(chartTitle);
  chartWrap.appendChild(chartCanvas);
  right.appendChild(chartWrap);

  wrap.appendChild(left);
  wrap.appendChild(right);
  cont.appendChild(wrap);
  document.body.appendChild(cont);

  // Character button group for sidebar (if you have it; optional)
  const existingBtnRow = el("buttonRow");
  if (existingBtnRow && !el("characterButtons")) {
    const charBtns = document.createElement("div");
    charBtns.id = "characterButtons";
    charBtns.style.cssText = "display:none; flex-direction:column; background:rgba(240,240,240,0.97); border-radius:16px; box-shadow:0 2px 12px #0002; padding:11px 18px 11px 13px; margin-right:10px;";
    charBtns.innerHTML = `
      <button id="charRegisterBtn2">Register Character</button>
      <button id="charEditBtn2">Edit Selected</button>
      <button id="charAdminDeleteBtn2" style="background:#c95c5c; color:#fff;">Admin Delete</button>
    `;
    const hexButtons = el("hexButtons");
    if (hexButtons && hexButtons.nextSibling) {
      existingBtnRow.insertBefore(charBtns, hexButtons.nextSibling);
    } else {
      existingBtnRow.appendChild(charBtns);
    }
    el("charRegisterBtn2").onclick = openCharacterRegister;
    el("charEditBtn2").onclick = openCharacterEdit;
    el("charAdminDeleteBtn2").onclick = adminDeleteSelectedCharacter;
  }

  // Wire top controls
  el("charRegisterBtn").onclick = openCharacterRegister;
  el("charEditBtn").onclick = openCharacterEdit;
  el("charAdminDeleteBtn").onclick = adminDeleteSelectedCharacter;
  el("charPicker").addEventListener("change", e => {
    selectedCharacterId = e.target.value || null;
    renderCharacterDirectory();
  });
}

// Password hashing
async function hashText(toHash) {
  const enc = new TextEncoder().encode(toHash);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  const view = new DataView(buf);
  let hex = "";
  for (let i = 0; i < view.byteLength; i++) {
    const v = view.getUint8(i).toString(16).padStart(2, "0");
    hex += v;
  }
  return hex;
}

// Live characters
async function subscribeCharacters() {
  if (unsubscribeCharacters) unsubscribeCharacters();
  const colRef = collection(db, "characters");
  unsubscribeCharacters = onSnapshot(colRef, (snap) => {
    characters = [];
    snap.forEach(docSnap => {
      const d = docSnap.data() || {};
      characters.push({
        id: docSnap.id,
        name: "",
        age: "",
        occupation: "",
        backstory: "",
        race: "",
        origin: "",
        status: "",
        ap: 0, aap: 0, dp: 0,
        wealth: 0, political: 0, military: 0, business: 0,
        videoURL: "",
        passwordHash: "",
        createdAt: 0,
        ...d
      });
    });
    populateCharacterPicker();
    if (currentView === "characters") renderCharacterDirectory();
  }, (err) => {
    console.error("Character snapshot error:", err);
  });
}

function populateCharacterPicker() {
  const picker = el("charPicker");
  if (!picker) return;
  const prev = picker.value;
  picker.innerHTML = `<option value="">— Select Character —</option>`;
  characters.sort((a,b) => (a.name||"").localeCompare(b.name||""));
  characters.forEach(ch => {
    const opt = document.createElement("option");
    opt.value = ch.id;
    opt.textContent = ch.name || "(Unnamed)";
    picker.appendChild(opt);
  });
  if (prev && characters.some(c => c.id === prev)) {
    picker.value = prev;
    selectedCharacterId = prev;
  } else if (!selectedCharacterId && characters.length) {
    selectedCharacterId = characters[0].id;
    picker.value = selectedCharacterId;
  }
}

// ====== Character Register + Create (with URL OR Upload to Storage) ======
function openCharacterRegister() { openCharacterRegisterModal(); }
function openCharacterEdit() {
  if (!selectedCharacterId) return alert("Select a character first from the dropdown.");
  openCharacterEditModal(selectedCharacterId);
}
function closeModal(id) { const m = el(id); if (m) m.remove(); }

function openCharacterRegisterModal() {
  const modal = document.createElement("div");
  modal.id = "charRegisterModal";
  modal.style.cssText = `
    position:fixed; left:50%; top:50%; transform:translate(-50%,-50%);
    background:#fff; color:#222; z-index:3000; min-width:300px;
    border-radius:16px; border:2px solid #444; box-shadow:0 12px 32px #000a;
    padding:20px;
  `;
  modal.innerHTML = `
    <div style="font-weight:700; margin-bottom:10px;">Register Character — Set Password</div>
    <div style="font-size:14px; opacity:.8; margin-bottom:10px;">You'll use this password to edit your character later.</div>
    <label>Password:<br><input type="password" id="charRegPw" style="width:260px;"></label><br>
    <label>Confirm:<br><input type="password" id="charRegPw2" style="width:260px;"></label><br>
    <div style="margin-top:12px;">
      <button id="charRegNext">Next</button>
      <button id="charRegCancel" style="margin-left:6px;">Cancel</button>
    </div>
  `;
  document.body.appendChild(modal);
  el("charRegCancel").onclick = () => closeModal("charRegisterModal");
  el("charRegNext").onclick = async () => {
    const p1 = el("charRegPw").value;
    const p2 = el("charRegPw2").value;
    if (!p1 || p1 !== p2) return alert("Passwords must match.");
    const hash = await hashText(p1);
    closeModal("charRegisterModal");
    openCharacterCreateModal(hash);
  };
}

function openCharacterCreateModal(passwordHash) {
  const modal = document.createElement("div");
  modal.id = "charCreateModal";
  modal.style.cssText = `
    position:fixed; left:50%; top:50%; transform:translate(-50%,-50%);
    background:#fff; color:#222; z-index:3000; width:min(720px, 94vw);
    border-radius:16px; border:2px solid #444; box-shadow:0 12px 32px #000a;
    padding:16px;
  `;
  modal.innerHTML = `
    <div style="font-weight:800; margin-bottom:10px;">Create Character</div>
    <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
      <label>Name<br><input id="chName" style="width:100%"></label>
      <label>Age<br><input id="chAge" style="width:100%"></label>
      <label>Occupation<br><input id="chOcc" style="width:100%"></label>

      <div style="grid-column:1 / span 2; display:grid; grid-template-columns:1fr 1fr; gap:8px; align-items:end;">
        <label style="display:block;">Video URL<br><input id="chVid" placeholder="https://i.imgur.com/....mp4 (or leave blank)" style="width:100%"></label>
        <div>
          <label style="display:block;">Or Upload Video<br><input type="file" id="chVidFile" accept="video/mp4,video/webm" style="width:100%"></label>
          <div id="chVidProgress" style="font-size:12px; color:#444; height:18px;"></div>
        </div>
      </div>

      <label>Race<br>
        <select id="chRace" style="width:100%">
          <option>Human</option>
          <option>Half-Human/Elf</option>
          <option>Half-Human/Giant</option>
          <option>Half-Human/Dwarf</option>
          <option>Luthragon Elf</option>
          <option>Vedir Elf</option>
          <option>Ganelle Elf</option>
          <option>Ahib Elf</option>
          <option>Giant</option>
          <option>Dwarf</option>
          <option>Shai</option>
          <option>Other (specify in backstory)</option>
        </select>
      </label>
      <label>Origin/Location<br>
        <select id="chOrigin" style="width:100%">
          <option>Calpheon</option>
          <option>Mediah</option>
          <option>Land of the Morning Light</option>
          <option>Valencia</option>
          <option>Mountain of Eternal Winter</option>
          <option>Duvencrune</option>
          <option>Balenos</option>
          <option>Serendia</option>
          <option>Odyllita</option>
          <option>Kamasylvia</option>
          <option>Islands of Margoria/Oquilla</option>
          <option>Other (specify in backstory)</option>
        </select>
      </label>
      <label>Status<br>
        <select id="chStatus" style="width:100%">
          <option>Noble</option>
          <option>Knight</option>
          <option>Merchant</option>
          <option>Artisan</option>
          <option>Commoner</option>
          <option>Peasant</option>
        </select>
      </label>

      <label>AP (Attack Power)<br><input id="chAP" type="number" min="0" style="width:100%"></label>
      <label>AAP (Awakened AP)<br><input id="chAAP" type="number" min="0" style="width:100%"></label>
      <label>DP (Defense Power)<br><input id="chDP" type="number" min="0" style="width:100%"></label>
      <label>Wealth (1-10)<br><input id="chWealth" type="number" min="0" max="10" style="width:100%"></label>
      <label>Political Acumen (1-10)<br><input id="chPol" type="number" min="0" max="10" style="width:100%"></label>
      <label>Military Acumen (1-10)<br><input id="chMil" type="number" min="0" max="10" style="width:100%"></label>
      <label>Business Acumen (1-10)<br><input id="chBiz" type="number" min="0" max="10" style="width:100%"></label>
    </div>

    <label style="display:block; margin-top:10px;">Backstory<br>
      <textarea id="chBack" style="width:100%; height:120px;"></textarea>
    </label>

    <div style="margin-top:12px;">
      <button id="chCreateSave">Save</button>
      <button id="chCreateCancel" style="margin-left:6px;">Cancel</button>
    </div>
  `;
  document.body.appendChild(modal);

  el("chCreateCancel").onclick = () => closeModal("charCreateModal");

  // Upload handler
  let uploadedVideoURL = "";
  el("chVidFile").addEventListener("change", async (ev) => {
    const file = ev.target.files && ev.target.files[0];
    if (!file) return;
    const progress = el("chVidProgress");
    progress.textContent = "Uploading… 0%";
    try {
      // Temporary storage path; we need a document id — generate a push-like id
      const tempId = "temp-" + Math.random().toString(36).slice(2);
      const path = `characterVideos/${tempId}/${file.name}`;
      const r = sRef(storage, path);
      const task = uploadBytesResumable(r, file, { contentType: file.type });
      await new Promise((resolve, reject) => {
        task.on("state_changed",
          (snap) => {
            const pct = Math.round((snap.bytesTransferred / snap.totalBytes) * 100);
            progress.textContent = `Uploading… ${pct}%`;
          },
          (err) => reject(err),
          async () => {
            uploadedVideoURL = await getDownloadURL(task.snapshot.ref);
            progress.textContent = "Upload complete ✔";
            // Put the URL into the URL box so the user can see/save it
            el("chVid").value = uploadedVideoURL;
            resolve();
          }
        );
      });
    } catch (err) {
      console.error(err);
      el("chVidProgress").textContent = "Upload failed.";
      alert("Upload failed. Please try again or use a direct URL.");
    }
  });

  el("chCreateSave").onclick = async () => {
    const payload = {
      name: el("chName").value.trim(),
      age: el("chAge").value.trim(),
      occupation: el("chOcc").value.trim(),
      backstory: el("chBack").value.trim(),
      race: el("chRace").value,
      origin: el("chOrigin").value,
      status: el("chStatus").value,
      ap: Number(el("chAP").value || 0),
      aap: Number(el("chAAP").value || 0),
      dp: Number(el("chDP").value || 0),
      wealth: Number(el("chWealth").value || 0),
      political: Number(el("chPol").value || 0),
      military: Number(el("chMil").value || 0),
      business: Number(el("chBiz").value || 0),
      videoURL: normalizeVideoURL(el("chVid").value.trim() || uploadedVideoURL || ""),
      passwordHash: passwordHash,
      createdAt: Date.now()
    };
    if (!payload.name) return alert("Please enter a character name.");

    try {
      const refDoc = await addDoc(collection(db, "characters"), payload);

      // If we uploaded to a temp path, move would require re-upload; we avoid moving.
      // Future uploads should use known doc id from edit modal.

      closeModal("charCreateModal");
      selectedCharacterId = refDoc.id;
      populateCharacterPicker();
      renderCharacterDirectory();
      alert("Character created! Keep your password safe so you can edit later.");
    } catch (err) {
      console.error(err);
      alert("Could not create character. Please try again.");
    }
  };
}

// ====== Edit Character (password check) with upload + admin delete ======
async function openCharacterEditModal(charId) {
  const ch = characters.find(c => c.id === charId);
  if (!ch) return alert("Character not found.");

  const pw = prompt(`Enter password for "${ch.name}" to edit:`);
  if (pw == null) return;
  const hash = await hashText(pw);
  if ((ch.passwordHash || "") !== hash) {
    return alert("Incorrect password.");
  }

  const modal = document.createElement("div");
  modal.id = "charEditModal";
  modal.style.cssText = `
    position:fixed; left:50%; top:50%; transform:translate(-50%,-50%);
    background:#fff; color:#222; z-index:3000; width:min(720px, 94vw);
    border-radius:16px; border:2px solid #444; box-shadow:0 12px 32px #000a;
    padding:16px;
  `;
  modal.innerHTML = `
    <div style="font-weight:800; margin-bottom:10px;">Edit Character — ${ch.name}</div>
    <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
      <label>Name<br><input id="edName" style="width:100%" value="${ch.name || ""}"></label>
      <label>Age<br><input id="edAge" style="width:100%" value="${ch.age || ""}"></label>
      <label>Occupation<br><input id="edOcc" style="width:100%" value="${ch.occupation || ""}"></label>

      <div style="grid-column:1 / span 2; display:grid; grid-template-columns:1fr 1fr; gap:8px; align-items:end;">
        <label style="display:block;">Video URL<br><input id="edVid" style="width:100%" value="${ch.videoURL || ""}"></label>
        <div>
          <label style="display:block;">Or Upload New Video<br><input type="file" id="edVidFile" accept="video/mp4,video/webm" style="width:100%"></label>
          <div id="edVidProgress" style="font-size:12px; color:#444; height:18px;"></div>
        </div>
      </div>

      <label>Race<br>
        <select id="edRace" style="width:100%"></select>
      </label>
      <label>Origin/Location<br>
        <select id="edOrigin" style="width:100%"></select>
      </label>
      <label>Status<br>
        <select id="edStatus" style="width:100%"></select>
      </label>

      <label>AP<br><input id="edAP" type="number" min="0" style="width:100%" value="${ch.ap || 0}"></label>
      <label>AAP<br><input id="edAAP" type="number" min="0" style="width:100%" value="${ch.aap || 0}"></label>
      <label>DP<br><input id="edDP" type="number" min="0" style="width:100%" value="${ch.dp || 0}"></label>
      <label>Wealth (1-10)<br><input id="edWealth" type="number" min="0" max="10" style="width:100%" value="${ch.wealth || 0}"></label>
      <label>Political (1-10)<br><input id="edPol" type="number" min="0" max="10" style="width:100%" value="${ch.political || 0}"></label>
      <label>Military (1-10)<br><input id="edMil" type="number" min="0" max="10" style="width:100%" value="${ch.military || 0}"></label>
      <label>Business (1-10)<br><input id="edBiz" type="number" min="0" max="10" style="width:100%" value="${ch.business || 0}"></label>
    </div>

    <label style="display:block; margin-top:10px;">Backstory<br>
      <textarea id="edBack" style="width:100%; height:120px;">${ch.backstory || ""}</textarea>
    </label>

    <div style="margin-top:12px;">
      <button id="edSave">Save</button>
      <button id="edDelete" style="margin-left:6px; background:#b35a5a; color:#fff;">Delete</button>
      <button id="edCancel" style="margin-left:6px;">Cancel</button>
    </div>
  `;
  document.body.appendChild(modal);

  const raceOpts = [
    "Human","Half-Human/Elf","Half-Human/Giant","Half-Human/Dwarf","Luthragon Elf","Vedir Elf","Ganelle Elf","Ahib Elf","Giant","Dwarf","Shai","Other (specify in backstory)"
  ];
  const originOpts = [
    "Calpheon","Mediah","Land of the Morning Light","Valencia","Mountain of Eternal Winter","Duvencrune","Balenos","Serendia","Odyllita","Kamasylvia","Islands of Margoria/Oquilla","Other (specify in backstory)"
  ];
  const statusOpts = ["Noble","Knight","Merchant","Artisan","Commoner","Peasant"];

  function fillSelect(elm, list, val) {
    elm.innerHTML = list.map(v => `<option ${v===val?'selected':''}>${v}</option>`).join("");
  }
  fillSelect(el("edRace"), raceOpts, ch.race || "Human");
  fillSelect(el("edOrigin"), originOpts, ch.origin || "Calpheon");
  fillSelect(el("edStatus"), statusOpts, ch.status || "Commoner");

  el("edCancel").onclick = () => closeModal("charEditModal");
  el("edDelete").onclick = async () => {
    if (!confirm(`Delete ${ch.name}?`)) return;
    try {
      await deleteDoc(doc(db, "characters", ch.id));
      closeModal("charEditModal");
      selectedCharacterId = null;
      populateCharacterPicker();
      renderCharacterDirectory();
    } catch (err) {
      console.error(err);
      alert("Could not delete character.");
    }
  };

  // Upload new video to a doc-tied path
  el("edVidFile").addEventListener("change", async (ev) => {
    const file = ev.target.files && ev.target.files[0];
    if (!file) return;
    const progress = el("edVidProgress");
    progress.textContent = "Uploading… 0%";
    try {
      const path = `characterVideos/${ch.id}/${file.name}`;
      const r = sRef(storage, path);
      const task = uploadBytesResumable(r, file, { contentType: file.type });
      await new Promise((resolve, reject) => {
        task.on("state_changed",
          (snap) => {
            const pct = Math.round((snap.bytesTransferred / snap.totalBytes) * 100);
            progress.textContent = `Uploading… ${pct}%`;
          },
          (err) => reject(err),
          async () => {
            const url = await getDownloadURL(task.snapshot.ref);
            el("edVid").value = url;
            progress.textContent = "Upload complete ✔";
            resolve();
          }
        );
      });
    } catch (err) {
      console.error(err);
      el("edVidProgress").textContent = "Upload failed.";
      alert("Upload failed. Please try again.");
    }
  });

  el("edSave").onclick = async () => {
    const updated = {
      name: el("edName").value.trim(),
      age: el("edAge").value.trim(),
      occupation: el("edOcc").value.trim(),
      backstory: el("edBack").value.trim(),
      race: el("edRace").value,
      origin: el("edOrigin").value,
      status: el("edStatus").value,
      ap: Number(el("edAP").value || 0),
      aap: Number(el("edAAP").value || 0),
      dp: Number(el("edDP").value || 0),
      wealth: Number(el("edWealth").value || 0),
      political: Number(el("edPol").value || 0),
      military: Number(el("edMil").value || 0),
      business: Number(el("edBiz").value || 0),
      videoURL: normalizeVideoURL(el("edVid").value.trim()),
      passwordHash: ch.passwordHash,
      createdAt: ch.createdAt || Date.now()
    };
    if (!updated.name) return alert("Name is required.");
    try {
      await setDoc(doc(db, "characters", ch.id), updated);
      closeModal("charEditModal");
      selectedCharacterId = ch.id;
      populateCharacterPicker();
      renderCharacterDirectory();
      alert("Saved!");
    } catch (err) {
      console.error(err);
      alert("Could not save character.");
    }
  };
}

// Admin delete from header/sidebar button (no password)
async function adminDeleteSelectedCharacter() {
  if (!isAdmin) return alert("Admin login required.");
  if (!selectedCharacterId) return alert("Select a character first.");
  const ch = characters.find(c => c.id === selectedCharacterId);
  if (!ch) return;
  if (!confirm(`Admin delete "${ch.name}"?`)) return;
  try {
    await deleteDoc(doc(db, "characters", ch.id));
    selectedCharacterId = null;
    populateCharacterPicker();
    renderCharacterDirectory();
    alert("Character deleted.");
  } catch (err) {
    console.error(err);
    alert("Could not delete character.");
  }
}

// Render directory
function renderCharacterDirectory() {
  ensureCharacterDOM();

  // Toggle edit/admin delete buttons
  const editTop = el("charEditBtn");
  const editSide = el("charEditBtn2");
  const delTop = el("charAdminDeleteBtn");
  const delSide = el("charAdminDeleteBtn2");

  const allowEditButton = !!selectedCharacterId;
  if (editTop) editTop.style.display = allowEditButton ? "inline-block" : "none";
  if (editSide) editSide.style.display = allowEditButton ? "inline-block" : "none";

  const showAdminDelete = isAdmin && !!selectedCharacterId;
  if (delTop) delTop.style.display = showAdminDelete ? "inline-block" : "none";
  if (delSide) delSide.style.display = showAdminDelete ? "inline-block" : "none";

  const nameHdr = el("charNameHdr");
  const video = el("charVideo");
  const details = el("charDetails");

  if (!selectedCharacterId || !characters.length) {
    if (nameHdr) nameHdr.textContent = "Character Directory";
    if (video) { video.src = ""; }
    if (details) details.innerHTML = `<div style="opacity:.85;">Select a character from the dropdown to view their story.</div>`;
    drawCharacterChart(null);
    return;
  }

  const ch = characters.find(c => c.id === selectedCharacterId);
  if (!ch) {
    drawCharacterChart(null);
    return;
  }

  if (details) {
    details.innerHTML = `
      <div><b>Age:</b> ${ch.age || "—"}</div>
      <div><b>Occupation:</b> ${ch.occupation || "—"}</div>
      <div><b>Race:</b> ${ch.race || "—"}</div>
      <div><b>Origin/Location:</b> ${ch.origin || "—"}</div>
      <div><b>Status:</b> ${ch.status || "—"}</div>
      <div style="margin-top:8px; white-space:pre-wrap;"><b>Backstory:</b><br>${ch.backstory || "—"}</div>
    `;
  }

  if (nameHdr) nameHdr.textContent = ch.name || "Unnamed";
  if (video) {
    const url = normalizeVideoURL(ch.videoURL || "");
    video.loop = true;
    video.muted = true;
    video.autoplay = true;
    video.playsInline = true;
    video.controls = false;
    video.src = ""; // reset then set
    video.src = url;

    const tryPlay = () => {
      video.play().catch(() => {
        // If autoplay is blocked or media error, enable controls so user can tap play
        video.controls = true;
      });
    };
    video.oncanplay = tryPlay;
    setTimeout(tryPlay, 80);
    video.onerror = () => {
      video.controls = true;
    };
  }

  drawCharacterChart(ch);
}

// Chart
function drawCharacterChart(selected) {
  const canvas = el("charChart");
  if (!canvas) return;
  const c = canvas.getContext("2d");
  c.clearRect(0, 0, canvas.width, canvas.height);

  const metrics = [
    { key: "ap", label: "AP" },
    { key: "aap", label: "AAP" },
    { key: "dp", label: "DP" },
    { key: "wealth", label: "Wealth (1-10)" },
    { key: "political", label: "Political (1-10)" },
    { key: "military", label: "Military (1-10)" },
    { key: "business", label: "Business (1-10)" }
  ];

  const maxVals = {};
  metrics.forEach(m => {
    maxVals[m.key] = Math.max(1, ...characters.map(ch => Number(ch[m.key] || 0)));
  });

  const leftPad = 140;
  const rightPad = 24;
  const topPad = 14;
  const barH = 26;
  const gap = 12;

  c.font = "14px Cinzel, serif";
  c.textBaseline = "middle";

  metrics.forEach((m, idx) => {
    const y = topPad + idx * (barH + gap) + barH / 2;
    c.fillStyle = "#ffe7ad";
    c.fillText(m.label, 8, y);

    const usableW = canvas.width - leftPad - rightPad;
    c.fillStyle = "#2a1a10";
    c.fillRect(leftPad, y - barH/2, usableW, barH);
    c.strokeStyle = "#a97b36";
    c.lineWidth = 1;
    c.strokeRect(leftPad, y - barH/2, usableW, barH);

    if (!selected) return;

    const val = Number(selected[m.key] || 0);
    const max = maxVals[m.key] || 1;
    const w = Math.round(usableW * (val / max));

    c.fillStyle = "#d2a85c";
    c.fillRect(leftPad, y - (barH-6)/2, Math.max(0, w), barH-6);

    c.fillStyle = "#fff";
    c.fillText(String(val), leftPad + Math.max(8, w - 26), y);
  });
}

// ================== INIT ==================
window.onload = async () => {
  resizeCanvas();
  await loadGrid();
  await loadAdventureGrid();
  await loadRanks();
  await loadBusinesses();
  await subscribeCharacters(); // live character list
  updateRankUI();
  renderBusinesses();

  initBoardSelect();
  ensureCharacterDOM();

  if (boardSelect) boardSelect.value = "hex";
  currentView = "hex";
  refreshViewVisibility();
};
