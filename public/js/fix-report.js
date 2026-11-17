// public/js/fix-report.js
import { db, generateWorkOrderId, insertAuditLog } from "./firestore.js";
import {
  collection,
  doc,
  setDoc,
  getDocs,
  query,
  orderBy,
  limit,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// 🎯 นำ URL ที่ได้จากการ Deploy Google Apps Script (Web App) มาวางตรงนี้
const GAS_UPLOAD_WEBAPP_URL = "https://script.google.com/macros/s/AKfycbzxSYnyWENRzLeAZofflP58HIecjkFqoueC4J09fvSAP1MOIpxfzJef18SxtZ1AcivxMg/exec";

let currentUser = null;
let selectedFiles = []; 
let reportsMap = {};

// ============================================================================
// 1. แสดงโปรไฟล์บน Navbar & ตรวจสอบ Session
// ============================================================================
// ============================================================================
// 1. แสดงโปรไฟล์บน Navbar
// ============================================================================
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

// ============================================================================
// 2. ตรวจสอบเงื่อนไขฟอร์ม (บังคับสถานที่ + รายละเอียด + รูป 1-6 รูป)
// ============================================================================
function validateFormState() {
  const locationVal = document.getElementById("location")?.value.trim();
  const detailVal = document.getElementById("damage-detail")?.value.trim();
  const submitBtn = document.getElementById("submit-fix-report");
  const hintText = document.getElementById("form-validation-hint");

  const isValid = Boolean(locationVal && detailVal && selectedFiles.length >= 1 && selectedFiles.length <= 6);
  if (submitBtn) submitBtn.disabled = !isValid;
  if (hintText) hintText.hidden = isValid;
}

// ============================================================================
// 3. จัดการการเลือกรูปภาพ (1 - 6 รูป) และแสดง Preview
// ============================================================================
function handleFileSelection(event) {
  const files = Array.from(event.target.files || []);
  const imageFiles = files.filter(f => f.type.startsWith("image/"));

  if (imageFiles.length > 6) {
    Swal.fire("แจ้งเตือน", "สามารถแนบรูปภาพได้สูงสุด 6 รูปเท่านั้น ระบบจะเลือก 6 รูปแรกให้", "warning");
  }

  selectedFiles = imageFiles.slice(0, 6);
  renderImagePreviews();
  validateFormState();
}

function renderImagePreviews() {
  const grid = document.getElementById("image-preview-grid");
  if (!grid) return;

  if (selectedFiles.length === 0) {
    grid.innerHTML = "";
    return;
  }

  grid.innerHTML = selectedFiles.map((file, idx) => {
    const objectUrl = URL.createObjectURL(file);
    return `
      <div class="col-4 col-md-2">
        <div class="position-relative border rounded overflow-hidden bg-white shadow-sm">
          <img src="${objectUrl}" class="w-100" style="height: 90px; object-fit: cover;" alt="preview">
          <button type="button" class="btn btn-danger btn-sm position-absolute top-0 end-0 m-1 py-0 px-1"
                  onclick="removeSelectedImage(${idx})" title="ลบรูปนี้">
            <i class="bi bi-x"></i>
          </button>
        </div>
      </div>
    `;
  }).join("");
}

window.removeSelectedImage = function(index) {
  selectedFiles.splice(index, 1);
  if (selectedFiles.length === 0) {
    document.getElementById("fix-images").value = "";
  }
  renderImagePreviews();
  validateFormState();
};

function compressImageToBase64(file, maxWidth = 1280, quality = 0.8) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let width = img.width;
        let height = img.height;
        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);

        const dataUrl = canvas.toDataURL("image/jpeg", quality);
        resolve({
          name: file.name,
          mimeType: "image/jpeg",
          base64: dataUrl.split(",")[1]
        });
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ============================================================================
// 4. ส่งข้อมูลแจ้งซ่อม (ออกเลข wo_id -> อัปโหลด Drive -> บันทึก fix_report)
// ============================================================================
async function handleSubmitFixReport(event) {
  event.preventDefault();

  const locationText = document.getElementById("location").value.trim();
  const detailText = document.getElementById("damage-detail").value.trim();

  if (!locationText || !detailText || selectedFiles.length === 0) {
    Swal.fire("ข้อมูลไม่ครบถ้วน", "กรุณาระบุสถานที่ อาการชำรุด และแนบรูปภาพอย่างน้อย 1 รูป", "warning");
    return;
  }

  if (!GAS_UPLOAD_WEBAPP_URL.startsWith("https://script.google.com/")) {
    Swal.fire("ยังไม่ได้ตั้งค่า GAS URL", "กรุณานำ URL ของ Google Apps Script มาใส่ในตัวแปร GAS_UPLOAD_WEBAPP_URL", "error");
    return;
  }

  Swal.fire({
    title: "กำลังบันทึกการแจ้งซ่อม...",
    html: `กำลังออกเลขใบแจ้งซ่อมและอัปโหลดรูปภาพ (${selectedFiles.length} รูป)`,
    allowOutsideClick: false,
    didOpen: () => Swal.showLoading()
  });

  try {
    // 1. ออกเลขที่ใบแจ้งซ่อม wo_id (เช่น WO-2569-0001)
    const woId = await generateWorkOrderId();

    // 2. ย่อรูปและอัปโหลดไปยัง Google Drive ผ่าน GAS (ตั้งชื่อไฟล์ขึ้นต้นด้วย wo_id)
    const compressedFiles = await Promise.all(
      selectedFiles.map(file => compressImageToBase64(file))
    );

    const gasRes = await fetch(GAS_UPLOAD_WEBAPP_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({
        prefix: woId,
        files: compressedFiles
      })
    });

    const gasResult = await gasRes.json();
    if (!gasResult.success) {
      throw new Error(gasResult.message || "อัปโหลดรูปภาพไปยัง Google Drive ล้มเหลว");
    }

    // 3. บันทึกข้อมูลตามโครงสร้าง 10 ฟิลด์ลง Firestore Collection 'fix_report'
    const reportData = {
      wo_id: woId,
      location: locationText,
      detail: detailText,
      images: gasResult.files,
      status: "pending",
      line_user_id: currentUser.line_user_id || currentUser.id || "",
      reporter_name: currentUser.name || "ไม่ระบุชื่อ",
      reporter_pos: currentUser.pos || currentUser.position || "",
      created_at: serverTimestamp(),
      updated_at: serverTimestamp()
    };

    await setDoc(doc(db, "fix_report", woId), reportData);

    await insertAuditLog("CREATE_FIX_REPORT", `แจ้งซ่อมเลขที่ ${woId} สถานที่: ${locationText}`, currentUser);

    // รีเซ็ตฟอร์ม
    document.getElementById("fix-report-form").reset();
    selectedFiles = [];
    renderImagePreviews();
    validateFormState();

    Swal.fire({
      icon: "success",
      title: `ส่งแจ้งซ่อมสำเร็จ!`,
      text: `เลขที่ใบแจ้งซ่อมของคุณคือ ${woId}`,
      confirmButtonColor: "#0d233a"
    });

    loadFixReports();
  } catch (error) {
    console.error("❌ Submit Fix Report Error:", error);
    Swal.fire("เกิดข้อผิดพลาด", error.message, "error");
  }
}

// ============================================================================
// 5. โหลดรายการแจ้งซ่อมล่าสุด
// ============================================================================
async function loadFixReports() {
  const tbody = document.getElementById("fix-reports-tbody");
  if (!tbody) return;

  try {
    const q = query(collection(db, "fix_report"), orderBy("created_at", "desc"), limit(50));
    const snap = await getDocs(q);

    if (snap.empty) {
      tbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted py-4">ยังไม่มีรายการแจ้งซ่อม</td></tr>`;
      return;
    }

    const statusBadge = {
      pending: '<span class="badge bg-warning text-dark">รอรับเรื่อง / จ่ายงาน</span>',
      assigned: '<span class="badge bg-info text-dark">กำลังดำเนินการ</span>',
      escalated: '<span class="badge bg-danger">ส่งต่อช่างผู้เชี่ยวชาญ</span>',
      done: '<span class="badge bg-success">ซ่อมเสร็จสิ้น</span>'
    };

    reportsMap = {};
    let html = "";

    snap.forEach((docSnap) => {
      const d = docSnap.data();
      const woId = d.wo_id || docSnap.id;
      reportsMap[woId] = d; // เก็บข้อมูลไว้ให้ปุ่มดูรูปเรียกใช้

      const dateStr = d.created_at?.toDate
        ? d.created_at.toDate().toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" })
        : "-";
      const imgCount = Array.isArray(d.images) ? d.images.length : 0;

      const imgButtonHtml = imgCount > 0
        ? `<button type="button" class="btn btn-sm btn-outline-primary rounded-pill px-3" onclick="viewReportImages('${woId}')">
             <i class="bi bi-images me-1"></i>ดู ${imgCount} รูป
           </button>`
        : `<span class="badge bg-secondary">ไม่มีรูป</span>`;

      html += `
        <tr>
          <td class="small fw-bold text-primary">${woId}</td>
          <td class="small">${dateStr}</td>
          <td class="small fw-semibold">${d.reporter_name || "-"}</td>
          <td class="small">${d.location || "-"}</td>
          <td class="small">${d.detail || "-"}</td>
          <td>${imgButtonHtml}</td>
          <td>${statusBadge[d.status] || statusBadge.pending}</td>
        </tr>
      `;
    });

    tbody.innerHTML = html;
  } catch (error) {
    console.error("❌ Load Fix Reports Error:", error);
    tbody.innerHTML = `<tr><td colspan="7" class="text-center text-danger py-4">โหลดข้อมูลไม่สำเร็จ: ${error.message}</td></tr>`;
  }
}

/**
 * 🖼️ เปิดหน้าต่างแสดงรูปภาพทั้งหมดของใบแจ้งซ่อม
 */
window.viewReportImages = function(woId) {
  const report = reportsMap[woId];
  if (!report || !Array.isArray(report.images) || report.images.length === 0) {
    Swal.fire("ไม่พบรูปภาพ", "รายการนี้ไม่มีรูปภาพแนบ", "info");
    return;
  }

  const imagesHtml = report.images.map((img, idx) => {
    // ใช้ลิงก์ thumbnail ความละเอียดสูงของ Drive เพื่อให้โหลดแสดงผลในหน้าเว็บได้เสถียรไม่ติดบล็อกคุกกี้
    const displayUrl = img.fileId
      ? `https://drive.google.com/thumbnail?id=${img.fileId}&sz=w1000`
      : img.url;
    const driveLink = img.webViewLink || img.url;

    return `
      <div class="col-12 col-md-6">
        <div class="card h-100 shadow-sm border">
          <a href="${driveLink}" target="_blank" rel="noopener noreferrer" title="คลิกเพื่อเปิดรูปขนาดเต็มใน Google Drive">
            <img src="${displayUrl}"
                 onerror="this.onerror=null; this.src='${img.url}';"
                 class="card-img-top"
                 style="height: 220px; object-fit: cover; background: #f8f9fa;"
                 alt="รูปที่ ${idx + 1}">
          </a>
          <div class="card-footer bg-white py-2 d-flex justify-content-between align-items-center">
            <span class="small text-muted">รูปที่ ${idx + 1}</span>
            <a href="${driveLink}" target="_blank" rel="noopener noreferrer" class="btn btn-sm btn-light border">
              <i class="bi bi-box-arrow-up-right me-1"></i>เปิดรูปเต็ม
            </a>
          </div>
        </div>
      </div>
    `;
  }).join("");

  Swal.fire({
    title: `รูปภาพประกอบ (${woId})`,
    html: `
      <div class="text-start mb-3 p-2 bg-light rounded border small">
        <div><strong>สถานที่:</strong> ${report.location || "-"}</div>
        <div><strong>อาการ:</strong> ${report.detail || "-"}</div>
      </div>
      <div class="row g-3 text-start">
        ${imagesHtml}
      </div>
    `,
    width: "800px",
    confirmButtonText: "ปิดหน้าต่าง",
    confirmButtonColor: "#0d233a"
  });
};
// ============================================================================
// 6. INITIALIZATION
// ============================================================================
async function initialize() {
  const userSessionStr = sessionStorage.getItem("kbs_user");
  if (!userSessionStr) {
    window.location.href = "index.html";
    return;
  }

  currentUser = JSON.parse(userSessionStr);
  initUserProfile(currentUser);

  document.querySelectorAll("[data-view]").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("[data-view]").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      const targetId = btn.getAttribute("data-view");
      document.querySelectorAll(".panel").forEach(p => p.hidden = (p.id !== targetId));
    });
  });

  document.getElementById("location")?.addEventListener("input", validateFormState);
  document.getElementById("damage-detail")?.addEventListener("input", validateFormState);
  document.getElementById("fix-images")?.addEventListener("change", handleFileSelection);
  document.getElementById("fix-report-form")?.addEventListener("submit", handleSubmitFixReport);
  document.getElementById("refresh-reports")?.addEventListener("click", loadFixReports);

  loadFixReports();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initialize);
} else {
  initialize();
}