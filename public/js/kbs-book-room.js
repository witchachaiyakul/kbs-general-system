// public/js/kbs-book-room.js
import "./auth-guard.js";
import { db, generateBookingNumber, getCommitteeByLineId, getKbsPlaces, insertAuditLog } from "./firestore.js";
import {
  Timestamp,
  collection,
  doc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  where,
  writeBatch
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

const statuses = {
  "รออนุมัติ": "bg-warning text-dark",
  "อนุมัติ": "bg-success",
  "ไม่อนุมัติ": "bg-danger"
};

const dateFormatter = new Intl.DateTimeFormat("th-TH", {
  timeZone: "Asia/Bangkok",
  dateStyle: "medium",
  timeStyle: "short"
});

const appMessage = document.getElementById("app-message");
let publicBookingsBody;
let adminBookingsBody;
let cachedPublicBookings = [];
let availablePlaces = [];
let currentUser = null;

// ==========================================
// 🛡️ ตรวจสอบ Session จาก LINE Login & ดึงข้อมูลจาก committees
// ==========================================
const isLocal = ["localhost", "127.0.0.1"].includes(window.location.hostname);
const MAIN_PORTAL_URL = isLocal ? "index.html" : "https://kbs-gm.web.app/";

function redirectToPortal() {
  sessionStorage.removeItem("kbs_user");
  window.location.href = `${MAIN_PORTAL_URL}?redirect=${encodeURIComponent(window.location.href)}`;
}

async function initAuthSession() {
  const userSessionStr = sessionStorage.getItem("kbs_user");
  if (!userSessionStr) {
    redirectToPortal();
    return false;
  }

  try {
    currentUser = JSON.parse(userSessionStr);
  } catch (e) {
    console.error("❌ อ่านข้อมูล Session ล้มเหลว:", e);
    redirectToPortal();
    return false;
  }

  // 1. ตรวจสอบวันหมดอายุของ Session
  if (currentUser.expiresAt && Date.now() > currentUser.expiresAt) {
    redirectToPortal();
    return false;
  }

  // 2. ใช้ข้อมูลที่ auth-guard.js ดึงมาให้แล้ว (หากข้อมูลไม่ครบค่อยดึงเสริมจาก Firestore)
  const lineUserId = currentUser.line_user_id || currentUser.userId || currentUser.id;
  if (lineUserId && (!currentUser.name || !currentUser.role)) {
    const committeeData = await getCommitteeByLineId(lineUserId);
    if (committeeData) {
      currentUser = {
        ...currentUser,
        committeeId: committeeData.docId,
        line_user_id: lineUserId,
        name: committeeData.name || currentUser.name,
        pos: committeeData.pos || currentUser.pos || "",
        role: (committeeData.role || currentUser.role || "staff").toLowerCase(),
        general_permission: Array.isArray(committeeData.general_permission)
          ? committeeData.general_permission
          : []
      };
      sessionStorage.setItem("kbs_user", JSON.stringify(currentUser));
    } else {
      showMessage(appMessage, "ไม่พบข้อมูลทะเบียนบุคลากร กรุณาติดต่อผู้ดูแลระบบ", true);
      return false;
    }
  }

  // 3. ตรวจสอบสิทธิ์การเข้าถึงเมนูจองห้อง ('kbsroom') สำหรับผู้ใช้ที่ไม่ใช่ Admin
  const role = (currentUser.role || "staff").toLowerCase();
  const isAdmin = role === "admin";
  const perms = Array.isArray(currentUser.general_permission) ? currentUser.general_permission : [];
  if (!isAdmin && perms.length > 0 && !perms.includes("kbsroom")) {
    alert("คุณไม่มีสิทธิ์เข้าใช้งานระบบจองห้องประชุม");
    window.location.href = MAIN_PORTAL_URL;
    return false;
  }

  // 4. แสดงข้อมูลบน Navbar มาตรฐานเดียวกับทุกระบบ
  initUserProfile(currentUser);

  // 5. เปิดแท็บ "สำหรับผู้ดูแล" เฉพาะ Role: admin
  const adminTabBtn = document.getElementById("tab-admin-btn");
  if (adminTabBtn) {
    adminTabBtn.hidden = !isAdmin;
  }
  if (isAdmin) {
    const adminIdentity = document.getElementById("admin-identity");
    if (adminIdentity) {
      adminIdentity.textContent = `ผู้ดูแลระบบ: ${currentUser.name || lineUserId}`;
    }
  }

  return true;
}

function initUserProfile(user) {
    const nameElem = document.getElementById("headerUserName");
    const posElem = document.getElementById("headerUserPosition");
    const roleElem = document.getElementById("headerUserRole");
    const imgElem = document.getElementById("headerUserImg");

    if (nameElem) nameElem.textContent = user.name || "ผู้ใช้งาน";
    if (posElem) posElem.textContent = `ตำแหน่ง: ${user.pos || user.position || "บุคลากร"}`;
    if (roleElem) roleElem.textContent = `Role: ${(user.role || "staff").toUpperCase()}`;
    if (imgElem && user.picture) imgElem.src = user.picture;
}
// ==========================================
// 🔔 UI Helpers
// ==========================================
function showMessage(element, message, isError) {
  if (!element) return;
  element.textContent = message;
  element.classList.remove("alert-info", "alert-success", "alert-danger");
  element.classList.add(isError ? "alert-danger" : "alert-success");
  element.hidden = false;
}

function clearMessage(element) {
  if (!element) return;
  element.textContent = "";
  element.hidden = true;
}

function setBusy(button, busy, busyText) {
  if (!button) return;
  if (!button.dataset.label) button.dataset.label = button.innerHTML;
  button.disabled = busy;
  button.innerHTML = busy ? busyText : button.dataset.label;
}

function timestampDate(value) {
  if (value && typeof value.toDate === "function") return value.toDate();
  return value instanceof Date ? value : new Date(value);
}

function displayDate(value) {
  const date = timestampDate(value);
  return Number.isNaN(date.getTime()) ? "-" : dateFormatter.format(date);
}

function createCell(text) {
  const cell = document.createElement("td");
  cell.textContent = text || "-";
  return cell;
}

function createStatus(status) {
  const badge = document.createElement("span");
  badge.className = `badge ${statuses[status] || "bg-warning text-dark"}`;
  badge.textContent = status;
  return badge;
}

// ==========================================
// 🏢 ระบบจัดการอุปกรณ์และสิ่งอำนวยความสะดวกประจำห้อง
// ==========================================
function getPlaceEquipmentList(place) {
  if (!place) return [];

  // ค้นหาฟิลด์ equipment หรือ facilities แบบยืดหยุ่น (ตัดช่องว่างเว้นวรรค เช่น "equipment ")
  let equipData = place.equipment || place.facilities;
  if (!equipData) {
    const matchedKey = Object.keys(place).find((k) => {
      const clean = k.trim().toLowerCase();
      return clean === "equipment" || clean === "facilities";
    });
    if (matchedKey) equipData = place[matchedKey];
  }

  // 1. ถ้ามีฟิลด์ equipment ใน Firestore
  if (Array.isArray(equipData) && equipData.length > 0) {
    return equipData;
  }
  if (typeof equipData === "string" && equipData.trim()) {
    return equipData.split(/[,;\n]/).map(s => s.trim()).filter(Boolean);
  }

  // 2. ข้อมูลอุปกรณ์เริ่มต้นตามประเภท/ชื่อห้องของโรงเรียนกาญจนาภิเษกวิทยาลัย กระบี่
  const name = (place.name || "").toLowerCase();
  if (name.includes("auditorium") || name.includes("audiotorium")) {
    return ["Projector พร้อมจอภาพ", "เครื่องเสียงห้องประชุม", "ไมโครโฟนไร้สาย 2 ตัว", "เครื่องปรับอากาศ", "คอมพิวเตอร์ควบคุม"];
  }
  if (name.includes("หอประชุม")) {
    return ["เวทีการแสดงขนาดใหญ่", "ระบบเครื่องเสียงหอประชุม", "ไมโครโฟน 4 ตัว", "Projector พร้อมจอภาพ", "ไฟสปอตไลท์"];
  }
  if (name.includes("ช่อราชพฤกษ์")) {
    return ["Projector พร้อมจอภาพ", "เครื่องเสียง", "ไมโครโฟน 2 ตัว", "เครื่องปรับอากาศ"];
  }
  if (name.includes("โดม")) {
    return ["ลานกิจกรรมอเนกประสงค์", "เวทีกิจกรรม", "ระบบเครื่องเสียงกลางแจ้ง", "ไมโครโฟนไร้สาย 2 ตัว"];
  }
  if (name.includes("ราชพฤกษ์")) {
    return ["Projector พร้อมจอภาพ", "เครื่องเสียงห้องประชุม", "ไมโครโฟน 2 ตัว", "เครื่องปรับอากาศ"];
  }
  if (name.includes("ทูบี") || name.includes("to be")) {
    return ["เวทีกิจกรรม", "เครื่องเสียง", "ไมโครโฟน", "เครื่องปรับอากาศ"];
  }
  if (name.includes("สมาคม") || name.includes("ผู้ปกครอง")) {
    return ["โต๊ะประชุม", "เครื่องปรับอากาศ", "กระดานไวท์บอร์ด", "ไมโครโฟน"];
  }
  return ["เครื่องเสียงห้องประชุม", "ไมโครโฟน", "เครื่องปรับอากาศ"];
}

function getEquipmentIcon(item) {
  const text = (item || "").toLowerCase();
  if (text.includes("projector") || text.includes("โปรเจคเตอร์") || text.includes("จอ") || text.includes("tv")) return "📽️";
  if (text.includes("เสียง") || text.includes("ลำโพง")) return "🔊";
  if (text.includes("ไมค์") || text.includes("mic")) return "🎙️";
  if (text.includes("แอร์") || text.includes("ปรับอากาศ")) return "❄️";
  if (text.includes("เวที") || text.includes("ลาน")) return "🎭";
  if (text.includes("คอม") || text.includes("pc")) return "💻";
  if (text.includes("โต๊ะ") || text.includes("เก้าอี้")) return "🪑";
  if (text.includes("บอร์ด") || text.includes("กระดาน")) return "📋";
  if (text.includes("ไฟ")) return "💡";
  return "✨";
}

function renderRoomFacilities(placeId) {
  const container = document.getElementById("room-facilities-card");
  const emptyHint = document.getElementById("facility-empty-hint");
  const content = document.getElementById("facility-content");
  const nameElem = document.getElementById("facility-room-name");
  const capBadge = document.getElementById("facility-room-cap");
  const tagList = document.getElementById("facility-tags");

  if (!container || !emptyHint || !content) return;

  const place = availablePlaces.find((p) => String(p.id) === String(placeId));
  if (!place) {
    container.classList.remove("active");
    emptyHint.classList.remove("d-none");
    content.classList.add("d-none");
    if (tagList) tagList.innerHTML = "";
    return;
  }

  container.classList.add("active");
  emptyHint.classList.add("d-none");
  content.classList.remove("d-none");

  if (nameElem) {
    nameElem.innerHTML = `<i class="bi bi-building-check text-gold me-1"></i> รายการอุปกรณ์และสิ่งอำนวยความสะดวกใน <strong>${place.name}</strong>:`;
  }

  if (capBadge) {
    if (place.capacity) {
      capBadge.textContent = `รองรับ ${place.capacity} คน`;
      capBadge.classList.remove("d-none");
    } else {
      capBadge.classList.add("d-none");
    }
  }

  const items = getPlaceEquipmentList(place);
  if (tagList) {
    tagList.innerHTML = "";
    items.forEach((item) => {
      const tag = document.createElement("span");
      tag.className = "facility-tag";
      tag.innerHTML = `<span class="tag-icon">${getEquipmentIcon(item)}</span> <span>${item}</span>`;
      tagList.appendChild(tag);
    });
  }
}

// ==========================================
// 🏢 ระบบการเลือกห้องประชุมแบบการ์ด (Grid) & แสดงรายละเอียด
// ==========================================
let currentSelectedPlace = null;

function selectRoom(place) {
  if (!place) return;

  const locationInput = document.getElementById("location");

  // หากกดซ้ำห้องเดิมที่เลือกอยู่ ให้ยกเลิกการเลือกทันที (Toggle Deselect)
  if (locationInput && locationInput.value === String(place.id)) {
    resetRoomSelection(true);
    return;
  }

  currentSelectedPlace = place;

  if (locationInput) {
    locationInput.value = place.id;
  }

  // ปรับสถานะการเน้นสีของการ์ดห้องที่เลือก (Selected State)
  document.querySelectorAll(".room-card").forEach((card) => {
    const isThis = card.dataset.placeId === String(place.id);
    card.classList.toggle("selected", isThis);
    card.setAttribute("aria-selected", isThis ? "true" : "false");
  });

  // ซ่อนกล่องแจ้งเตือน และเปิดส่วนรายละเอียดการจอง
  const detailsSection = document.getElementById("booking-details-section");
  const promptBanner = document.getElementById("room-selection-prompt");
  if (detailsSection) {
    detailsSection.classList.remove("d-none");
  }
  if (promptBanner) {
    promptBanner.classList.add("d-none");
  }

  // อัปเดตแถบชื่อห้องและป้ายความจุในส่วนรายละเอียด
  const currentRoomName = document.getElementById("current-room-name");
  const currentRoomCap = document.getElementById("current-room-capacity");
  if (currentRoomName) currentRoomName.textContent = place.name;
  if (currentRoomCap) {
    if (place.capacity) {
      currentRoomCap.textContent = `รองรับ ${place.capacity} คน`;
      currentRoomCap.classList.remove("d-none");
    } else {
      currentRoomCap.classList.add("d-none");
    }
  }

  // อัปเดตรายการอุปกรณ์ประจำห้อง
  renderRoomFacilities(place.id);

  // เลื่อนหน้าจอลงมายังส่วนรายละเอียดอย่างนุ่มนวล
  if (detailsSection) {
    setTimeout(() => {
      detailsSection.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }, 150);
  }
}

function resetRoomSelection(scrollBack = true) {
  currentSelectedPlace = null;
  const locationInput = document.getElementById("location");
  if (locationInput) locationInput.value = "";

  document.querySelectorAll(".room-card").forEach((card) => {
    card.classList.remove("selected");
    card.setAttribute("aria-selected", "false");
  });

  const detailsSection = document.getElementById("booking-details-section");
  const promptBanner = document.getElementById("room-selection-prompt");
  if (detailsSection) detailsSection.classList.add("d-none");
  if (promptBanner) promptBanner.classList.remove("d-none");

  renderRoomFacilities("");

  if (scrollBack) {
    const roomGrid = document.getElementById("room-grid");
    if (roomGrid) {
      roomGrid.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }
}

// ==========================================
// 🖼️ ระบบป๊อปอัปดูรูปภาพภายในห้องประชุม (3 รูป)
// ==========================================
function openPhotoLightbox(src, title) {
  const lbModalElem = document.getElementById("photoLightboxModal");
  if (!lbModalElem || !window.bootstrap) return;
  const lbImg = document.getElementById("lightboxImg");
  const lbTitle = document.getElementById("lightboxTitle");
  if (lbImg) lbImg.src = src;
  if (lbTitle) {
    lbTitle.innerHTML = `<i class="bi bi-image text-warning me-1"></i> ${title || "ภาพบรรยากาศ"}`;
  }
  const bsLightbox = window.bootstrap.Modal.getOrCreateInstance(lbModalElem);
  bsLightbox.show();
}

function showRoomPhotosModal(place) {
  if (!place) return;

  const modalElem = document.getElementById("roomPhotosModal");
  if (!modalElem || !window.bootstrap) return;

  const nameElem = document.getElementById("modalRoomName");
  const capElem = document.getElementById("modalRoomCapBadge");
  const grid = document.getElementById("modalPhotosGrid");

  if (nameElem) nameElem.textContent = place.name || "ห้องประชุม";
  if (capElem) {
    capElem.textContent = place.capacity ? `รองรับ ${place.capacity} คน` : "ห้องมาตรฐาน";
  }

  if (!grid) return;
  grid.innerHTML = "";

  const safeId = encodeURIComponent(String(place.id).trim());

  // กำหนด 3 รูปภาพภายในห้องประชุม (ไม่นับรวมรูปภาพหน้าปกของการ์ดห้อง)
  const slots = [
    {
      title: "รูปภายในห้องที่ 1",
      candidates: [
        `img/rooms/${safeId}_1.jpg`,
        `img/rooms/${safeId}_1.jpeg`,
        `img/rooms/${safeId}_1.png`
      ]
    },
    {
      title: "รูปภายในห้องที่ 2",
      candidates: [
        `img/rooms/${safeId}_2.jpg`,
        `img/rooms/${safeId}_2.jpeg`,
        `img/rooms/${safeId}_2.png`
      ]
    },
    {
      title: "รูปภายในห้องที่ 3",
      candidates: [
        `img/rooms/${safeId}_3.jpg`,
        `img/rooms/${safeId}_3.jpeg`,
        `img/rooms/${safeId}_3.png`
      ]
    }
  ];

  // ถ้าใน Firestore มี array interior_photos หรือ gallery ให้ดึงมาใช้แทน/เสริม
  const customList = Array.isArray(place.interior_photos)
    ? place.interior_photos
    : (Array.isArray(place.gallery) ? place.gallery : null);
  if (customList && customList.length > 0) {
    customList.forEach((url, i) => {
      if (slots[i] && url) {
        slots[i].candidates.unshift(url);
      }
    });
  }

  slots.forEach((slot, idx) => {
    const col = document.createElement("div");
    col.className = "col-md-4 col-12";

    const card = document.createElement("div");
    card.className = "modal-photo-card";

    const frame = document.createElement("div");
    frame.className = "modal-photo-frame";
    frame.title = "คลิกเพื่อดูรูปภาพขนาดใหญ่";

    const img = document.createElement("img");
    img.alt = slot.title;
    img.loading = "lazy";

    let cIdx = 0;
    img.src = slot.candidates[cIdx];

    img.addEventListener("error", () => {
      cIdx += 1;
      if (cIdx < slot.candidates.length) {
        img.src = slot.candidates[cIdx];
      } else {
        frame.innerHTML = `
          <div class="modal-photo-placeholder">
            <i class="bi bi-camera"></i>
            <div class="fw-bold small text-white">รูปภายในห้องที่ ${idx + 1}</div>
            <div style="font-size: 0.74rem; color: #94a3b8; margin-top: 5px;">
              ยังไม่มีรูปภาพ<br>
              <span class="text-gold">(ตั้งชื่อ: ${safeId}_${idx + 1}.jpg)</span>
            </div>
          </div>
        `;
        frame.style.cursor = "default";
      }
    });

    frame.appendChild(img);
    frame.addEventListener("click", () => {
      const activeImg = frame.querySelector("img");
      if (activeImg && activeImg.src && !activeImg.src.endsWith("undefined")) {
        openPhotoLightbox(activeImg.src, `${place.name} - รูปที่ ${idx + 1}`);
      }
    });

    card.appendChild(frame);
    col.appendChild(card);
    grid.appendChild(col);
  });

  const bsModal = window.bootstrap.Modal.getOrCreateInstance(modalElem);
  bsModal.show();
}

async function populateRoomOptions() {
  const roomGrid = document.getElementById("room-grid");
  if (!roomGrid) {
    console.error("❌ ไม่พบ element #room-grid ในหน้าเว็บ");
    return;
  }

  // แสดงข้อความโหลด
  roomGrid.innerHTML = `
    <div class="col-12 text-center py-4" style="grid-column: 1 / -1; color: var(--kbs-text-secondary);">
      <div class="spinner-border text-warning spinner-border-sm me-2" role="status"></div>
      กำลังโหลดรายชื่อห้องประชุมจาก Firebase...
    </div>
  `;

  try {
    availablePlaces = await getKbsPlaces();
    console.log("📍 รายชื่อสถานที่ที่ได้รับ:", availablePlaces);

    roomGrid.innerHTML = "";
    if (!availablePlaces || availablePlaces.length === 0) {
      roomGrid.innerHTML = `
        <div class="col-12 text-center py-4 text-warning" style="grid-column: 1 / -1;">
          <i class="bi bi-exclamation-triangle me-1"></i> ไม่พบข้อมูลห้องประชุมในระบบ
        </div>
      `;
      return;
    }

    availablePlaces.forEach((place) => {
      const card = document.createElement("div");
      card.className = "room-card";
      card.dataset.placeId = String(place.id);
      card.tabIndex = 0;
      card.setAttribute("role", "button");
      card.setAttribute("aria-label", place.name);

      // รูปภาพห้องประชุม (ดึงจาก Firestore หรือดึงอัตโนมัติจาก img/rooms/{id}.jpg/.jpeg/.png หากไม่มีจะแสดงช่องสีขาว)
      const safeId = encodeURIComponent(String(place.id).trim());
      const photoCandidates = [];
      if (place.photoUrl || place.imageUrl) {
        photoCandidates.push(place.photoUrl || place.imageUrl);
      }
      photoCandidates.push(
        `img/rooms/${safeId}.jpg`,
        `img/rooms/${safeId}.jpeg`,
        `img/rooms/${safeId}.png`
      );

      const capText = place.capacity ? `รองรับ ${place.capacity} คน` : "ห้องมาตรฐาน";

      card.innerHTML = `
        <span class="room-selected-badge"><i class="bi bi-check-circle-fill"></i> เลือกแล้ว <span class="unselect-hint">(กดซ้ำเพื่อยกเลิก)</span></span>
        <div class="room-photo-frame">
          <img src="${photoCandidates[0]}" alt="${place.name}" loading="lazy">
        </div>
        <div class="room-card-info">
          <div class="room-card-title">${place.name}</div>
          <div class="room-card-meta">
            <span><i class="bi bi-people me-1"></i> ${capText}</span>
            <span class="text-gold small fw-semibold">คลิกเลือก <i class="bi bi-arrow-right"></i></span>
          </div>
        </div>
      `;

      const photoFrame = card.querySelector(".room-photo-frame");
      const photoImg = photoFrame ? photoFrame.querySelector("img") : null;
      if (photoImg) {
        let candidateIdx = 0;
        photoImg.addEventListener("error", () => {
          candidateIdx += 1;
          if (candidateIdx < photoCandidates.length) {
            photoImg.src = photoCandidates[candidateIdx];
          } else if (photoFrame) {
            photoFrame.innerHTML = `
              <div class="room-photo-placeholder">
                <i class="bi bi-building"></i>
                <span>รูปภาพห้องประชุม</span>
              </div>
            `;
          }
        });
      }

      card.addEventListener("click", () => {
        selectRoom(place);
      });

      card.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          selectRoom(place);
        }
      });

      roomGrid.appendChild(card);
    });

    // ผูกปุ่มดูรูปภาพภายในห้องประชุม (View Room Photos Modal)
    const btnPhotos = document.getElementById("btn-view-room-photos");
    if (btnPhotos && !btnPhotos.dataset.bound) {
      btnPhotos.dataset.bound = "true";
      btnPhotos.addEventListener("click", () => {
        if (currentSelectedPlace) {
          showRoomPhotosModal(currentSelectedPlace);
        } else {
          alert("กรุณาเลือกห้องประชุมก่อนกดดูรูปภาพ");
        }
      });
    }

    // ผูกปุ่มเปลี่ยนห้อง (Change Room)
    const btnChange = document.getElementById("btn-change-room");
    if (btnChange && !btnChange.dataset.bound) {
      btnChange.dataset.bound = "true";
      btnChange.addEventListener("click", () => {
        roomGrid.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }

    // ผูกปุ่มยกเลิกการเลือกห้อง (Cancel/Deselect Room)
    const btnCancel = document.getElementById("btn-cancel-room");
    if (btnCancel && !btnCancel.dataset.bound) {
      btnCancel.dataset.bound = "true";
      btnCancel.addEventListener("click", () => {
        resetRoomSelection(true);
      });
    }

  } catch (err) {
    console.error("❌ โหลดสถานที่ล้มเหลว:", err);
    roomGrid.innerHTML = `
      <div class="col-12 text-center py-4 text-danger" style="grid-column: 1 / -1;">
        <i class="bi bi-x-circle me-1"></i> โหลดข้อมูลสถานที่ล้มเหลว กรุณารีเฟรชหน้าเว็บอีกครั้ง
      </div>
    `;
  }
}

function populateYearFilter() {
  const select = document.getElementById("year-filter");
  if (!select) return;
  const currentYear = new Date().getFullYear();
  const allYears = document.createElement("option");
  allYears.value = "";
  allYears.textContent = "ทุกปี";
  select.append(allYears);

  for (let year = currentYear - 2; year <= currentYear + 5; year += 1) {
    const option = document.createElement("option");
    option.value = String(year);
    option.textContent = String(year + 543);
    select.append(option);
  }
  select.value = String(currentYear);
  const monthFilter = document.getElementById("month-filter");
  if (monthFilter) monthFilter.value = String(new Date().getMonth());
}

// ==========================================
// 📋 รายการจองสาธารณะ (Bookings View)
// ==========================================
function renderPublicBookings() {
  const month = document.getElementById("month-filter").value;
  const year = document.getElementById("year-filter").value;
  const visible = cachedPublicBookings.filter((booking) => {
    const date = timestampDate(booking.startTime);
    return (!month || date.getMonth() === Number(month)) &&
      (!year || date.getFullYear() === Number(year));
  });

  publicBookingsBody.replaceChildren();
  if (visible.length === 0) {
    const row = publicBookingsBody.insertRow();
    const cell = row.insertCell();
    cell.colSpan = 6;
    cell.className = "text-center text-muted py-4";
    cell.textContent = "ไม่พบรายการจองในช่วงเวลาที่เลือก";
    return;
  }

  visible.forEach((booking) => {
    const row = publicBookingsBody.insertRow();
    
    // เลขที่จอง (เช่น BR-2569/0001) หน้าชื่อผู้จอง
    const noCell = document.createElement("td");
    if (booking.bookingNo) {
      noCell.innerHTML = `<span class="badge" style="background: rgba(0, 212, 255, 0.12); color: #00d4ff; border: 1px solid rgba(0, 212, 255, 0.35); font-family: monospace; font-size: 0.88rem; padding: 0.35em 0.6em; font-weight: 600; letter-spacing: 0.5px;">${booking.bookingNo}</span>`;
    } else {
      noCell.innerHTML = `<span style="color: var(--kbs-text-secondary);">-</span>`;
    }

    row.append(
      noCell,
      createCell(booking.fullName),
      createCell(booking.location),
      createCell(displayDate(booking.startTime)),
      createCell(displayDate(booking.endTime))
    );
    const statusCell = row.insertCell();
    statusCell.append(createStatus(booking.status));
  });
}

async function loadPublicBookings() {
  publicBookingsBody.innerHTML = '<tr><td colspan="6" class="text-center text-muted py-4">กำลังโหลดข้อมูล...</td></tr>';
  try {
    const result = await getDocs(query(
      collection(db, "publicBookings"),
      orderBy("startTime", "desc"),
      limit(100)
    ));
    cachedPublicBookings = result.docs.map((snapshot) => snapshot.data());
    renderPublicBookings();
  } catch (error) {
    showMessage(appMessage, `โหลดรายการจองไม่สำเร็จ: ${error.message}`, true);
    publicBookingsBody.innerHTML = '<tr><td colspan="6" class="text-center text-danger py-4">ไม่สามารถโหลดข้อมูลได้</td></tr>';
  }
}

// ==========================================
// 📝 บันทึกคำขอจองใหม่ (ดึงชื่อและตำแหน่งจาก currentUser อัตโนมัติ)
// ==========================================
function getBookingFormData(form) {
  if (!currentUser || !currentUser.name) {
    throw new Error("ไม่พบข้อมูลผู้จอง กรุณาเข้าสู่ระบบใหม่อีกครั้ง");
  }

  const formData = new FormData(form);
  const startTime = new Date(formData.get("startTime"));
  const endTime = new Date(formData.get("endTime"));

  if (Number.isNaN(startTime.getTime()) || Number.isNaN(endTime.getTime()) || endTime <= startTime) {
    throw new Error("เวลาสิ้นสุดต้องอยู่หลังเวลาเริ่มต้น");
  }
  if (startTime <= new Date()) {
    throw new Error("กรุณาเลือกเวลาเริ่มใช้ในอนาคต");
  }

  const selectedPlaceId = String(formData.get("location") || "").trim();
  const selectedPlace = availablePlaces.find((p) => String(p.id) === selectedPlaceId);
  if (!selectedPlace) {
    const roomGrid = document.getElementById("room-grid");
    if (roomGrid) roomGrid.scrollIntoView({ behavior: "smooth", block: "start" });
    throw new Error("กรุณากดเลือกห้องประชุมที่ต้องการใช้งานด้านบน");
  }

  // ดึงรายการอุปกรณ์ประจำห้องอัตโนมัติ พร้อมสิ่งที่ผู้ใช้ระบุเพิ่มเติม
  const roomEquipment = getPlaceEquipmentList(selectedPlace);
  const extraEquip = String(formData.get("equipmentExtra") || "").trim();
  const finalEquipment = [...roomEquipment];
  if (extraEquip) {
    finalEquipment.push(`เพิ่มเติม: ${extraEquip}`);
  }
  if (finalEquipment.length === 0) {
    finalEquipment.push("อุปกรณ์มาตรฐานประจำห้อง");
  }

  return {
    line_user_id: currentUser.line_user_id || currentUser.userId || currentUser.id || "",
    fullName: currentUser.name,
    pos: currentUser.pos || currentUser.position || "",
    phone: String(formData.get("phone")).trim(),
    placeId: selectedPlace.id,     // บันทึกรหัส เช่น "11018"
    location: selectedPlace.name,  // บันทึกชื่อ เช่น "KBS Sport Center (อาคารศูนย์กีฬาชั้นล่าง)"
    purpose: String(formData.get("purpose")).trim(),
    startTime: Timestamp.fromDate(startTime),
    endTime: Timestamp.fromDate(endTime),
    equipment: finalEquipment,
    tables: Number(formData.get("tables") || 0),
    chairs: Number(formData.get("chairs") || 0),
    status: "รออนุมัติ"
  };
}

async function checkForRoomConflict(booking) {
  const conflicts = await getDocs(query(
    collection(db, "publicBookings"),
    where("location", "==", booking.location),
    where("startTime", "<", booking.endTime),
    orderBy("startTime", "desc"),
    limit(500)
  ));
  const start = booking.startTime.toMillis();
  return conflicts.docs.some((snapshot) => {
    const existing = snapshot.data();
    return existing.status !== "ไม่อนุมัติ" &&
      timestampDate(existing.endTime).getTime() > start;
  });
}

async function submitBooking(event) {
  event.preventDefault();
  clearMessage(appMessage);
  const form = event.currentTarget;
  const button = document.getElementById("submit-booking");
  setBusy(button, true, "กำลังบันทึก...");

  try {
    const booking = getBookingFormData(form);
    if (await checkForRoomConflict(booking)) {
      throw new Error("สถานที่มีรายการจองที่ทับซ้อนกัน กรุณาเลือกวันหรือเวลาใหม่");
    }

    // 🏛️ ออกเลขที่คำขอจองห้องประชุมตามระเบียบสารบรรณ (เช่น BR-2569/0001)
    const bookingNo = await generateBookingNumber();

    const batch = writeBatch(db);
    const bookingRef = doc(collection(db, "bookings"));
    const publicBookingRef = doc(db, "publicBookings", bookingRef.id);
    const createdAt = serverTimestamp();

    batch.set(bookingRef, {
      ...booking,
      bookingNo,
      createdAt,
      updatedAt: createdAt
    });
    batch.set(publicBookingRef, {
      bookingId: bookingRef.id,
      bookingNo,
      fullName: booking.fullName,
      pos: booking.pos,
      placeId: booking.placeId,
      location: booking.location,
      startTime: booking.startTime,
      endTime: booking.endTime,
      status: booking.status,
      createdAt,
      updatedAt: createdAt
    });
    await batch.commit();

    if (typeof insertAuditLog === "function" && currentUser) {
      await insertAuditLog("BOOK_ROOM", `ขอจอง ${booking.location} (${booking.purpose}) เลขที่ ${bookingNo}`, currentUser);
    }

    form.reset();
    resetRoomSelection();
    showMessage(appMessage, `ส่งคำขอจองเรียบร้อยแล้ว (เลขที่: ${bookingNo}) กรุณารอผู้ดูแลอนุมัติ`, false);
    await loadPublicBookings();
  } catch (error) {
    showMessage(appMessage, `ส่งคำขอไม่สำเร็จ: ${error.message}`, true);
  } finally {
    setBusy(button, false);
  }
}

// ==========================================
// ⚙️ ส่วนจัดการสำหรับผู้ดูแล (Admin View)
// ==========================================
function renderAdminBookings(bookings) {
  adminBookingsBody.replaceChildren();
  if (bookings.length === 0) {
    const row = adminBookingsBody.insertRow();
    const cell = row.insertCell();
    cell.colSpan = 7;
    cell.className = "text-center text-muted py-4";
    cell.textContent = "ไม่มีรายการจอง";
    return;
  }

  bookings.forEach((booking) => {
    const row = adminBookingsBody.insertRow();
    const bookerDisplay = booking.pos ? `${booking.fullName} (${booking.pos})` : booking.fullName;

    // เลขที่จอง (เช่น BR-2569/0001)
    const noCell = document.createElement("td");
    if (booking.bookingNo) {
      noCell.innerHTML = `<span class="badge" style="background: rgba(0, 212, 255, 0.12); color: #00d4ff; border: 1px solid rgba(0, 212, 255, 0.35); font-family: monospace; font-size: 0.88rem; padding: 0.35em 0.6em; font-weight: 600; letter-spacing: 0.5px;">${booking.bookingNo}</span>`;
    } else {
      noCell.innerHTML = `<span style="color: var(--kbs-text-secondary);">-</span>`;
    }

    row.append(
      noCell,
      createCell(displayDate(booking.startTime)),
      createCell(bookerDisplay),
      createCell(booking.phone),
      createCell(`${booking.location} — ${booking.purpose}`)
    );
    const statusCell = row.insertCell();
    statusCell.append(createStatus(booking.status));

    const actionCell = row.insertCell();
    if (booking.status === "รออนุมัติ") {
      const btnGroup = document.createElement("div");
      btnGroup.className = "d-flex gap-1";
      ["อนุมัติ", "ไม่อนุมัติ"].forEach((status) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = `btn btn-sm ${status === "อนุมัติ" ? "btn-success" : "btn-danger"}`;
        button.dataset.bookingId = booking.id;
        button.dataset.status = status;
        button.textContent = status;
        btnGroup.append(button);
      });
      actionCell.append(btnGroup);
    }
  });
}

async function loadAdminBookings() {
  if ((currentUser?.role || "").toLowerCase() !== "admin") return;
  adminBookingsBody.innerHTML = '<tr><td colspan="7" class="text-center text-muted py-4">กำลังโหลดข้อมูล...</td></tr>';
  try {
    const result = await getDocs(query(
      collection(db, "bookings"),
      orderBy("startTime", "desc"),
      limit(200)
    ));
    renderAdminBookings(result.docs.map((snapshot) => ({ id: snapshot.id, ...snapshot.data() })));
  } catch (error) {
    showMessage(appMessage, `โหลดข้อมูลผู้ดูแลไม่สำเร็จ: ${error.message}`, true);
    adminBookingsBody.innerHTML = '<tr><td colspan="7" class="text-center text-danger py-4">ไม่สามารถโหลดข้อมูลได้</td></tr>';
  }
}

async function updateBookingStatus(bookingId, status, button) {
  if ((currentUser?.role || "").toLowerCase() !== "admin") return;
  if (!["อนุมัติ", "ไม่อนุมัติ"].includes(status)) return;

  setBusy(button, true, "กำลังบันทึก...");
  clearMessage(appMessage);
  try {
    const batch = writeBatch(db);
    const updatePayload = {
      status,
      approvedBy: currentUser.name || currentUser.line_user_id || "",
      updatedAt: serverTimestamp()
    };
    batch.update(doc(db, "bookings", bookingId), updatePayload);
    batch.update(doc(db, "publicBookings", bookingId), { status, updatedAt: serverTimestamp() });
    await batch.commit();

    if (typeof insertAuditLog === "function") {
      await insertAuditLog("UPDATE_BOOKING", `ปรับสถานะคำขอจอง ${bookingId} เป็น "${status}"`, currentUser);
    }

    showMessage(appMessage, `เปลี่ยนสถานะเป็น "${status}" แล้ว`, false);
    await Promise.all([loadAdminBookings(), loadPublicBookings()]);
  } catch (error) {
    showMessage(appMessage, `ปรับสถานะไม่สำเร็จ: ${error.message}`, true);
    setBusy(button, false);
  }
}

// ==========================================
// 🔀 การสลับแท็บและการเริ่มต้นทำงาน
// ==========================================
function bindNavigation() {
  const tabButtons = document.querySelectorAll(".tab-button[data-view]");
  const panels = document.querySelectorAll("main .panel");

  tabButtons.forEach((button) => {
    button.addEventListener("click", () => {
      clearMessage(appMessage);

      tabButtons.forEach((btn) => btn.classList.remove("is-active", "active"));
      button.classList.add("is-active", "active");

      panels.forEach((panel) => { panel.hidden = true; });
      const target = document.getElementById(button.dataset.view);
      if (target) {
        target.hidden = false;
      }

      if (button.dataset.view === "bookings-view") {
        loadPublicBookings();
      } else if (button.dataset.view === "admin-view") {
        loadAdminBookings();
      }
    });
  });
}

async function initialize() {
  console.log("🚀 [kbs-book-room] initialize() เริ่มทำงาน...");

  // 1. โหลดรายการสถานที่และตัวกรองทันที ไม่ต้องรอ Auth
  await populateRoomOptions();
  populateYearFilter();
  bindNavigation();

  // 2. ตรวจสอบ Session และสิทธิ์ผู้ใช้งาน
  if (!(await initAuthSession())) return;

  publicBookingsBody = document.getElementById("public-bookings");
  adminBookingsBody = document.getElementById("admin-bookings");

  const bookingForm = document.getElementById("booking-form");
  bookingForm.addEventListener("submit", submitBooking);
  bookingForm.addEventListener("reset", () => {
    setTimeout(resetRoomSelection, 50);
  });
  document.getElementById("month-filter").addEventListener("change", renderPublicBookings);
  document.getElementById("year-filter").addEventListener("change", renderPublicBookings);
  document.getElementById("refresh-bookings").addEventListener("click", loadPublicBookings);
  document.getElementById("refresh-admin").addEventListener("click", loadAdminBookings);

  adminBookingsBody.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-booking-id]");
    if (button) {
      updateBookingStatus(button.dataset.bookingId, button.dataset.status, button);
    }
  });

  loadPublicBookings();
}

// ==========================================
// 🖼️ ระบบอัพโหลดรูปภาพ
// ==========================================
const selectedFiles = [];

function handleImageFiles(files) {
  const container = document.getElementById("img-preview-container");
  const countEl = document.getElementById("img-count");

  Array.from(files).forEach(file => {
    if (!file.type.startsWith("image/")) return;
    if (selectedFiles.length >= 5) {
      alert("อัพโหลดได้สูงสุด 5 รูปภาพ");
      return;
    }
    selectedFiles.push(file);

    const reader = new FileReader();
    reader.onload = (e) => {
      const placeholder = document.getElementById("img-placeholder");
      if (placeholder) placeholder.remove();

      const wrapper = document.createElement("div");
      wrapper.className = "position-relative";
      wrapper.style.cssText = "width:90px; height:90px;";

      const img = document.createElement("img");
      img.src = e.target.result;
      img.className = "rounded-2 border";
      img.style.cssText = "width:90px; height:90px; object-fit:cover;";

      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "btn btn-danger btn-sm position-absolute top-0 end-0 p-0 d-flex align-items-center justify-content-center";
      removeBtn.style.cssText = "width:20px; height:20px; font-size:11px;";
      removeBtn.innerHTML = '<i class="bi bi-x"></i>';
      removeBtn.onclick = () => {
        const idx = selectedFiles.indexOf(file);
        if (idx > -1) selectedFiles.splice(idx, 1);
        wrapper.remove();
        updateImgCount();
      };

      wrapper.appendChild(img);
      wrapper.appendChild(removeBtn);
      container.appendChild(wrapper);
      updateImgCount();
    };
    reader.readAsDataURL(file);
  });
}

function updateImgCount() {
  const countEl = document.getElementById("img-count");
  const container = document.getElementById("img-preview-container");
  if (selectedFiles.length > 0) {
    countEl.textContent = `เลือกแล้ว ${selectedFiles.length}/5 รูป`;
    countEl.hidden = false;
  } else {
    countEl.hidden = true;
    if (!document.getElementById("img-placeholder")) {
      container.innerHTML = `
        <div id="img-placeholder" class="text-center w-100">
          <div class="small" style="color:var(--kbs-text2);">ยังไม่ได้เลือกรูปภาพ (สูงสุด 5 รูป)</div>
        </div>`;
    }
  }
}

function runInit() {
  const imgUpload = document.getElementById("img-upload");
  const imgCamera = document.getElementById("img-camera");
  if (imgUpload && !imgUpload.dataset.bound) {
    imgUpload.dataset.bound = "true";
    imgUpload.addEventListener("change", (e) => { handleImageFiles(e.target.files); e.target.value = ""; });
  }
  if (imgCamera && !imgCamera.dataset.bound) {
    imgCamera.dataset.bound = "true";
    imgCamera.addEventListener("change", (e) => { handleImageFiles(e.target.files); e.target.value = ""; });
  }

  initialize();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", runInit);
} else {
  runInit();
}