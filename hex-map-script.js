// Firebase and canvas setup (keep your current firebase config)
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.9.0/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/11.9.0/firebase-auth.js";
import {
  getFirestore,
  doc,
  setDoc,
  getDoc,
  getDocs,
  collection,
  addDoc,
  deleteDoc
} from "https://www.gstatic.com/firebasejs/11.9.0/firebase-firestore.js";

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

let isAdmin = false;
let hoveredHexKey = null;
let inAdventureView = false;
let currentOrderType = null;
let adventureRanks = { S: [], A: [], B: [], C: [], D: [], E: [] };

// ----------- Dynamic grid scaling for hex map (reference: 2560x1440, 25x14 grid) -------------
const REFERENCE_WIDTH = 2560;
const REFERENCE_HEIGHT = 1440;
const gridCols = 25;
const gridRows = 14;

function getHexLayout() {
  const screenW = window.innerWidth;
  const screenH = window.innerHeight;
  const refHexWidth = REFERENCE_WIDTH / (gridCols + 0.5);
  const refHexHeight = REFERENCE_HEIGHT / ((gridRows - 1) * 0.75 + 1);
  const refHexSize = Math.min(refHexWidth / Math.sqrt(3), refHexHeight / 1.5);

  const hexWidth = screenW / (gridCols + 0.5);
  const hexHeight = screenH / ((gridRows - 1) * 0.75 + 1);
  const hexSize = Math.min(hexWidth / Math.sqrt(3), hexHeight / 1.5);

  const pixelWidth = hexSize * Math.sqrt(3) * (gridCols + 0.5);
  const pixelHeight = hexSize * 1.5 * (gridRows - 1) + hexSize * 2;
  const offsetX = (screenW - pixelWidth) / 2 + hexSize;
  const offsetY = (screenH - pixelHeight) / 2 + hexSize;

  return { hexSize, offsetX, offsetY };
}

// ---------------------- Auth and UI events ----------------------

onAuthStateChanged(auth, user => {
  isAdmin = !!user;
  document.getElementById("adminChat").style.display = isAdmin ? "block" : "none";
  document.getElementById("loginBox").style.display = "block";
  document.getElementById("hexButtons").style.display = (inAdventureView ? "none" : "flex");
  document.getElementById("adventureButtons").style.display = (inAdventureView ? "flex" : "none");
  document.getElementById("assignRanks").style.display = inAdventureView ? "block" : "none";
  updateRankUI();
  if (isAdmin) loadOrders();
});

window.login = () => {
  const email = document.getElementById("email").value;
  const password = document.getElementById("password").value;
  signInWithEmailAndPassword(auth, email, password)
    .then(() => alert("Logged in!"))
    .catch(err => alert("Login error: " + err.message));
};

window.logout = () => {
  signOut(auth);
  alert("Logged out.");
};

window.toggleView = () => {
  inAdventureView = !inAdventureView;
  document.getElementById("hexCanvasContainer").style.display = inAdventureView ? "none" : "block";
  document.getElementById("adventureCanvasContainer").style.display = inAdventureView ? "block" : "none";
  document.getElementById("hexButtons").style.display = inAdventureView ? "none" : "flex";
  document.getElementById("adventureButtons").style.display = inAdventureView ? "flex" : "none";
  document.getElementById("assignRanks").style.display = inAdventureView ? "block" : "none";
  document.getElementById("tooltip").style.display = "none";
  document.getElementById("lordPanel").style.display = "none";
  document.getElementById("advTooltip").style.display = "none";
  updateRankUI();
  resizeCanvas();
  if (inAdventureView) {
    loadAdventureGrid().then(() => renderAdventureGrid());
  } else {
    render();
  }
};

window.submitOrder = (type) => {
  currentOrderType = type;
  document.getElementById("orderPrompt").style.display = "block";
};

window.confirmOrder = async () => {
  const house = document.getElementById("nobleHouseInput").value;
  const target = document.getElementById("targetInput").value;
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

  await addDoc(collection(db, "orders"), {
    type: currentOrderType,
    house,
    target,
    message,
    timestamp: Date.now()
  });

  document.getElementById("orderPrompt").style.display = "none";
  document.getElementById("nobleHouseInput").value = "";
  document.getElementById("targetInput").value = "";

  if (isAdmin) loadOrders();
};

window.cancelOrder = () => {
  document.getElementById("orderPrompt").style.display = "none";
};

// Noble House Registration
window.registerNobleHouse = () => {
  document.getElementById("registerPrompt").style.display = "block";
};

window.confirmRegistration = async () => {
  const family = document.getElementById("familyNameInput").value;
  const domain = document.getElementById("domainInput").value;
  const heraldry = document.getElementById("heraldryInput").value;
  const message = `🏰 Noble House Registered:
Family: ${family}
Domain: ${domain}
Heraldry: ${heraldry}`;
  await addDoc(collection(db, "orders"), {
    type: "registration",
    house: family,
    target: domain,
    family,
    domain,
    heraldry,
    message,
    timestamp: Date.now()
  });

  document.getElementById("registerPrompt").style.display = "none";
  document.getElementById("familyNameInput").value = "";
  document.getElementById("domainInput").value = "";
  document.getElementById("heraldryInput").value = "";

  if (isAdmin) loadOrders();
};

window.cancelRegistration = () => {
  document.getElementById("registerPrompt").style.display = "none";
};

// Order Log
let highlightedOrders = [];
const hexGrid = {};

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
  highlightedOrders.forEach(({ key, originalColor }) => {
    if (hexGrid[key]) {
      hexGrid[key].color = originalColor;
    }
  });
  highlightedOrders = [];
  render();
}

window.loadOrders = async () => {
  const list = document.getElementById("orderList");
  list.innerHTML = "";
  const querySnapshot = await getDocs(collection(db, "orders"));
  querySnapshot.forEach(doc => {
    const data = doc.data();
    const li = document.createElement("li");
    li.textContent = `[${data.type}] ${data.house} -> ${data.target}`;
    li.style.cursor = "pointer";
    li.onclick = () => highlightOrderTargets(data);
    list.appendChild(li);
  });
};

window.clearOrders = async () => {
  const querySnapshot = await getDocs(collection(db, "orders"));
  querySnapshot.forEach(async docSnap => {
    await deleteDoc(doc(db, "orders", docSnap.id));
  });
  document.getElementById("orderList").innerHTML = "";
};

// --- HEX MAP LOGIC ---
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
  x -= offsetX;
  y -= offsetY;
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

function drawHex(x, y, color = "rgba(0,0,0,0)", label = "", isHovered = false) {
  const { hexSize } = getHexLayout();
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const angle = Math.PI / 180 * (60 * i + 30);
    const px = x + hexSize * Math.cos(angle);
    const py = y + hexSize * Math.sin(angle);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.strokeStyle = isHovered ? "yellow" : "rgba(0,0,0,0.7)";
  ctx.lineWidth = isHovered ? 4 : 2;
  ctx.stroke();
  if (color !== "rgba(0,0,0,0)") {
    ctx.fillStyle = color;
    ctx.fill();
  }
  if (label) {
    ctx.fillStyle = "#000";
    ctx.font = "bold 16px 'Cinzel', serif";
    ctx.textAlign = "center";
    ctx.fillText(label, x, y + 5);
  }
}

function render() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(background, 0, 0, canvas.width, canvas.height);
  Object.entries(hexGrid).forEach(([key, { q, r, color }]) => {
    const { x, y } = hexToPixel(q, r);
    drawHex(x, y, color, key, key === hoveredHexKey);
  });
}

canvas.addEventListener("click", async (e) => {
  if (!isAdmin) return alert("You must be logged in to edit.");
  const rect = canvas.getBoundingClientRect();
  const mouseX = e.clientX - rect.left;
  const mouseY = e.clientY - rect.top;
  const { q, r } = pixelToHex(mouseX, mouseY);
  const key = `${q},${r}`;
  let data = hexGrid[key] || { q, r, color: "rgba(0,0,0,0)", title: "Untitled", info: "", image: "", lord: "", lordInfo: "", lordVideo: "" };

  // Clear tile
  if (window.clearHexMode) {
    await setDoc(doc(db, "hexTiles", key), { q, r, color: "rgba(0,0,0,0)", title: "", info: "", image: "", lord: "", lordInfo: "", lordVideo: "" });
    hexGrid[key] = { q, r, color: "rgba(0,0,0,0)", title: "", info: "", image: "", lord: "", lordInfo: "", lordVideo: "" };
    window.clearHexMode = false;
    render();
    return;
  }

  const title = prompt("Enter title:", data.title);
  const info = prompt("Enter description:", data.info);
  const image = prompt("Enter image URL:", data.image);
  const color = prompt("Enter hex color (e.g. rgba(0,255,0,0.5)):", data.color);
  const lord = prompt("Enter Lord's Name:", data.lord);
  const lordInfoText = prompt("Enter Lord's Info:", data.lordInfo);
  const lordVideoURL = prompt("Enter Lord's Video URL:", data.lordVideo);

  data = { q, r, title, info, image, color, lord, lordInfo: lordInfoText, lordVideo: lordVideoURL };
  hexGrid[key] = data;
  await setDoc(doc(db, "hexTiles", key), data);
  render();
});

window.clearHexTile = () => {
  window.clearHexMode = true;
  alert("Click a hex to clear it.");
};

canvas.addEventListener("mousemove", (e) => {
  const rect = canvas.getBoundingClientRect();
  const mouseX = e.clientX - rect.left;
  const mouseY = e.clientY - rect.top;
  const { q, r } = pixelToHex(mouseX, mouseY);
  const key = `${q},${r}`;
  hoveredHexKey = key;
  const hex = hexGrid[key];

  if (hex && (hex.title || hex.info || hex.image)) {
    // LordPanel above tooltip
    lordPanel.style.display = "block";
    lordPanel.style.left = `${e.clientX + 10}px`;
    lordPanel.style.top = `${e.clientY - 205}px`; // Place higher up
    lordName.textContent = hex.lord || "Unknown Lord";
    lordInfo.textContent = hex.lordInfo || "";
    lordVideo.src = hex.lordVideo || "";
    lordVideo.loop = true;
    lordVideo.play();

    tooltip.style.display = "block";
    tooltip.style.left = `${e.clientX + 10}px`;
    tooltip.style.top = `${e.clientY + 35}px`;
    tooltip.innerHTML = `<strong>${hex.title}</strong><br>${hex.info}` +
      (hex.image ? `<br><img src="${hex.image}" style="width:100px;">` : "");
  } else {
    tooltip.style.display = "none";
    lordPanel.style.display = "none";
    lordVideo.pause();
  }
  render();
});

async function loadGrid() {
  const snap = await getDocs(collection(db, "hexTiles"));
  snap.forEach(docSnap => {
    const data = docSnap.data();
    hexGrid[`${data.q},${data.r}`] = data;
  });
  render();
}

// ------ ADVENTURE GRID LOGIC ------
const adventureCanvas = document.getElementById("adventureGrid");
const actx = adventureCanvas.getContext("2d");
const advBg = new Image();
advBg.src = "adventure.jpg";
let adventureGrid = {};
let advHover = null;
let adventureBgLoaded = false;
const advGridCols = 7;
const advGridRows = 7;
advBg.onload = () => {
  adventureBgLoaded = true;
  renderAdventureGrid();
};

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
  if (adventureBgLoaded) {
    actx.drawImage(advBg, 0, 0, adventureCanvas.width, adventureCanvas.height);
  } else {
    actx.fillStyle = "#ccc";
    actx.fillRect(0, 0, adventureCanvas.width, adventureCanvas.height);
  }
  const { cellSize, offsetX, offsetY } = getAdventureGridLayout();
  for (let r = 0; r < advGridRows; r++) {
    for (let c = 0; c < advGridCols; c++) {
      const key = `${c},${r}`;
      const cell = adventureGrid[key] || {};
      const x = offsetX + c * cellSize;
      const y = offsetY + r * cellSize;
      actx.fillStyle = cell.color || "rgba(255,255,255,0.3)";
      actx.fillRect(x, y, cellSize, cellSize);
      actx.strokeStyle = "black";
      actx.lineWidth = 1.5;
      actx.strokeRect(x, y, cellSize, cellSize);
    }
  }
  // Draw hover highlight
  if (advHover) {
    const { cellSize, offsetX, offsetY } = getAdventureGridLayout();
    const { c, r } = advHover;
    const x = offsetX + c * cellSize;
    const y = offsetY + r * cellSize;
    actx.save();
    actx.strokeStyle = "yellow";
    actx.lineWidth = 4;
    actx.strokeRect(x, y, cellSize, cellSize);
    actx.restore();
  }
}

adventureCanvas.addEventListener("click", async (e) => {
  if (!isAdmin) return;
  const { cellSize, offsetX, offsetY } = getAdventureGridLayout();
  const rect = adventureCanvas.getBoundingClientRect();
  const mouseX = e.clientX - rect.left;
  const mouseY = e.clientY - rect.top;
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

window.clearAdventureTile = () => {
  window.clearAdventureMode = true;
  alert("Click an adventure box to clear it.");
};

adventureCanvas.addEventListener("mousedown", async (e) => {
  if (!window.clearAdventureMode) return;
  const { cellSize, offsetX, offsetY } = getAdventureGridLayout();
  const rect = adventureCanvas.getBoundingClientRect();
  const mouseX = e.clientX - rect.left;
  const mouseY = e.clientY - rect.top;
  const c = Math.floor((mouseX - offsetX) / cellSize);
  const r = Math.floor((mouseY - offsetY) / cellSize);
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
  const mouseX = e.clientX - rect.left;
  const mouseY = e.clientY - rect.top;
  const c = Math.floor((mouseX - offsetX) / cellSize);
  const r = Math.floor((mouseY - offsetY) / cellSize);
  if (c < 0 || r < 0 || c >= advGridCols || r >= advGridRows) {
    advHover = null;
    document.getElementById("advTooltip").style.display = "none";
    renderAdventureGrid();
    return;
  }
  advHover = { c, r };
  renderAdventureGrid();
  const key = `${c},${r}`;
  const cell = adventureGrid[key];
  if (cell && (cell.type || cell.details || cell.image)) {
    const advTooltip = document.getElementById("advTooltip");
    advTooltip.style.display = "block";
    advTooltip.style.left = (e.clientX + 15) + "px";
    advTooltip.style.top = (e.clientY + 25) + "px";
    advTooltip.innerHTML =
      `<strong>${cell.type || "Unknown Mission"}</strong><br>` +
      (cell.details ? cell.details + "<br>" : "") +
      (cell.image ? `<img src="${cell.image}" style="width:90px; margin-top:5px;">` : "");
  } else {
    document.getElementById("advTooltip").style.display = "none";
  }
});

async function loadAdventureGrid() {
  adventureGrid = {};
  const snap = await getDocs(collection(db, "adventureGrid"));
  snap.forEach(docSnap => {
    const data = docSnap.data();
    adventureGrid[`${data.c},${data.r}`] = data;
  });
}

window.submitAdventureMission = () => {
  const type = prompt("What type of mission would you like to request?");
  const details = prompt("Please describe the mission details:");
  alert(`Mission Requested:\nType: ${type}\nDetails: ${details}`);
};

window.registerForMission = () => {
  const mission = prompt("Which mission would you like to accept?");
  const family = prompt("Enter your family name:");
  alert(`Registered for mission: ${mission}\nFamily: ${family}`);
};

// ---------- Adventure Ranks Save/Load ----------
async function loadRanks() {
  const docSnap = await getDoc(doc(db, "adventureRanks", "ranks"));
  if (docSnap.exists()) {
    adventureRanks = docSnap.data();
    updateRankUI();
  }
}
async function saveRanks() {
  await setDoc(doc(db, "adventureRanks", "ranks"), adventureRanks);
}
window.assignRank = async (rank) => {
  if (!isAdmin) return;
  const name = prompt(`Enter name for ${rank} rank:`);
  if (name) {
    adventureRanks[rank].push(name);
    await saveRanks();
    updateRankUI();
  }
};

function updateRankUI() {
  for (const rank of ["S", "A", "B", "C", "D", "E"]) {
    const el = document.getElementById(`rank${rank}`);
    el.textContent = adventureRanks[rank] ? adventureRanks[rank].join(", ") : "";
    if (isAdmin) {
      document.getElementById(`addRank${rank}`).style.display = "inline";
    } else {
      document.getElementById(`addRank${rank}`).style.display = "none";
    }
  }
}

// --------------- Sizing / Resize -------------
function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  adventureCanvas.width = window.innerWidth;
  adventureCanvas.height = window.innerHeight;
  render();
  renderAdventureGrid();
}

window.addEventListener("resize", () => {
  resizeCanvas();
});

// ----------- INIT -----------
window.onload = async () => {
  resizeCanvas();
  await loadGrid();
  await loadAdventureGrid();
  await loadRanks();
  updateRankUI();
};
