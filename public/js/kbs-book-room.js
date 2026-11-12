// public/js/kbs-book-room.js
import { db, getCommitteeByLineId, getKbsPlaces, insertAuditLog } from "./firestore.js";
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
async function initAuthSession() {
  const userSessionStr = sessionStorage.getItem("kbs_user");
  if (!userSessionStr) {
    window.location.href = "login.html";
    return false;
  }

  try {
    currentUser = JSON.parse(userSessionStr);
  } catch (e) {
    console.error("❌ อ่านข้อมูล Session ล้มเหลว:", e);
    sessionStorage.removeItem("kbs_user");
    window.location.href = "login.html";
    return false;
  }

  const lineUserId = currentUser.line_user_id || currentUser.userId || currentUser.id;
  if (lineUserId && lineUserId !== "DEV_USER_001") {
    const committeeData = await getCommitteeByLineId(lineUserId);
    if (committeeData) {
      currentUser = {
        ...currentUser,
        committeeId: committeeData.docId,
        line_user_id: lineUserId,
        name: committeeData.name || currentUser.name,
        pos: committeeData.pos || currentUser.pos || "",
        role: committeeData.role || currentUser.role || "staff"
      };
      sessionStorage.setItem("kbs_user", JSON.stringify(currentUser));
    } else {
      showMessage(appMessage, "ไม่พบข้อมูลทะเบียนบุคลากร กรุณาลงทะเบียนก่อนใช้งาน", true);
    }
  }
  // แสดงข้อมูลบน Navbar มาตรฐานเดียวกับทุกระบบ
  initUserProfile(currentUser);

  // ตรวจสอบสิทธิ์ Admin เพื่อเปิดแท็บจัดการคำขอจอง
  const isAdmin = (currentUser.role || "").toLowerCase() === "admin";
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

async function populateRoomOptions() {
  const select = document.getElementById("location");
  if (!select) return;

  select.innerHTML = '<option value="">กำลังโหลดรายชื่อสถานที่...</option>';
  availablePlaces = await getKbsPlaces();

  select.innerHTML = '<option value="">เลือกสถานที่</option>';
  if (availablePlaces.length === 0) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "ไม่พบข้อมูลสถานที่ในระบบ";
    option.disabled = true;
    select.append(option);
    return;
  }

  availablePlaces.forEach((place) => {
    const option = document.createElement("option");
    option.value = place.id; // เก็บรหัส เช่น "11018"
    option.textContent = place.capacity ? `${place.name} (รองรับ ${place.capacity} คน)` : place.name;
    select.append(option);
  });
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
    cell.colSpan = 5;
    cell.className = "text-center text-muted py-4";
    cell.textContent = "ไม่พบรายการจองในช่วงเวลาที่เลือก";
    return;
  }

  visible.forEach((booking) => {
    const row = publicBookingsBody.insertRow();
    row.append(
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
  publicBookingsBody.innerHTML = '<tr><td colspan="5" class="text-center text-muted py-4">กำลังโหลดข้อมูล...</td></tr>';
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
    publicBookingsBody.innerHTML = '<tr><td colspan="5" class="text-center text-danger py-4">ไม่สามารถโหลดข้อมูลได้</td></tr>';
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
    throw new Error("กรุณาเลือกสถานที่จากรายการ");
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
    equipment: formData.getAll("equipment"),
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

    const batch = writeBatch(db);
    const bookingRef = doc(collection(db, "bookings"));
    const publicBookingRef = doc(db, "publicBookings", bookingRef.id);
    const createdAt = serverTimestamp();

    batch.set(bookingRef, { ...booking, createdAt, updatedAt: createdAt });
    batch.set(publicBookingRef, {
      bookingId: bookingRef.id,
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
      await insertAuditLog("BOOK_ROOM", `ขอจอง ${booking.location} (${booking.purpose})`, currentUser);
    }

    form.reset();
    showMessage(appMessage, "ส่งคำขอจองเรียบร้อยแล้ว กรุณารอผู้ดูแลอนุมัติ", false);
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
    cell.colSpan = 6;
    cell.className = "text-center text-muted py-4";
    cell.textContent = "ไม่มีรายการจอง";
    return;
  }

  bookings.forEach((booking) => {
    const row = adminBookingsBody.insertRow();
    const bookerDisplay = booking.pos ? `${booking.fullName} (${booking.pos})` : booking.fullName;
    row.append(
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
  adminBookingsBody.innerHTML = '<tr><td colspan="6" class="text-center text-muted py-4">กำลังโหลดข้อมูล...</td></tr>';
  try {
    const result = await getDocs(query(
      collection(db, "bookings"),
      orderBy("startTime", "desc"),
      limit(200)
    ));
    renderAdminBookings(result.docs.map((snapshot) => ({ id: snapshot.id, ...snapshot.data() })));
  } catch (error) {
    showMessage(appMessage, `โหลดข้อมูลผู้ดูแลไม่สำเร็จ: ${error.message}`, true);
    adminBookingsBody.innerHTML = '<tr><td colspan="6" class="text-center text-danger py-4">ไม่สามารถโหลดข้อมูลได้</td></tr>';
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
  if (!(await initAuthSession())) return;

  publicBookingsBody = document.getElementById("public-bookings");
  adminBookingsBody = document.getElementById("admin-bookings");

  await populateRoomOptions();
  populateYearFilter();
  bindNavigation();

  document.getElementById("booking-form").addEventListener("submit", submitBooking);
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
}

document.addEventListener("DOMContentLoaded", initialize);