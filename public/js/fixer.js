// public/js/fixer.js
import { db, insertAuditLog } from "./firestore.js";
import {
  collection,
  doc,
  getDocs,
  updateDoc,
  query,
  orderBy,
  arrayUnion,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// 🎯 นำ URL ของ Google Apps Script (Web App) ตัวเดียวกับใน fix-report.js มาวางตรงนี้
const GAS_UPLOAD_WEBAPP_URL = "วาง_URL_ของ_GAS_WEB_APP_ที่นี่";

let currentUser = null;
let allFixReports = [];
let fixerSelectedFiles = []; // บังคับ 2 รูป

// ============================================================================
// 1. ตรวจสอบสิทธิ์ช่างซ่อม (kbsFixer / admin) & แสดง Navbar
// ============================================================================
function initFixerAuth() {
  const userSessionStr = sessionStorage.getItem("kbs_user");
  if (!userSessionStr) {
    window.location.href = "index.html";
    return false;
  }

  try {
    currentUser = JSON.parse(userSessionStr);
  } catch (e) {
    sessionStorage.removeItem("kbs_user");
    window.location.href = "index.html";
    return false;
  }

  // แสดงข้อมูลบน Navbar
  const nameElem = document.getElementById("headerUserName");
  const posElem = document.getElementById("headerUserPosition");
  const roleElem = document.getElementById("headerUserRole");
  const imgElem = document.getElementById("headerUserImg");

  if (nameElem) nameElem.textContent = currentUser.name || "ผู้ใช้งาน";
  if (posElem) posElem.textContent = `ตำแหน่ง: ${currentUser.pos || currentUser.position || "ช่างซ่อมบำรุง"}`;
  if (roleElem) roleElem.textContent = `Role: ${(currentUser.role || "staff").toUpperCase()}`;
  if (imgElem && currentUser.picture) imgElem.src = currentUser.picture;

  const role = (currentUser.role || "").toLowerCase();
  const perms = Array.isArray(currentUser.general_permission) ? currentUser.general_permission : [];
  const canAccessFixer = role === "admin" || perms.includes("kbsFixer") || perms.includes("kbsFixAdmin");

  if (!canAccessFixer) {
    Swal.fire({
      icon: "error",
      title: "ไม่มีสิทธิ์เข้าถึง",
      text: "คุณไม่ได้รับสิทธิ์เข้าถึงระบบปฏิบัติงานช่างซ่อมบำรุง",
      confirmButtonColor: "#0d233a"
    }).then(() => {
      window.location.href = "index.html";
    });
    return false;
  }

  return true;
}

// ============================================================================
// 2. โหลดรายการใบแจ้งซ่อมจาก Firestore 'fix_report'
// ============================================================================
async function loadFixerJobs() {
  const container = document.getElementById("fixerJobsContainer");
  if (!container) return;

  try {
    const q = query(collection(db, "fix_report"), orderBy("created_at", "desc"));
    const snap = await getDocs(q);

    allFixReports = [];
    snap.forEach((docSnap) => {
      const d = docSnap.data();
      allFixReports.push({
        id: docSnap.id,
        wo_id: d.wo_id || docSnap.id,
        ...d
      });
    });

    renderFixerJobCards();
  } catch (error) {
    console.error("❌ โหลดรายการงานช่างล้มเหลว:", error);
    container.innerHTML = `
      <div class="col-12">
        <div class="alert alert-danger">ไม่สามารถโหลดรายการงานซ่อมได้: ${error.message}</div>
      </div>
    `;
  }
}

function isAssignedToCurrentUser(report) {
  if (!report.assigned_to) return false;
  const myDocId = currentUser.docId || "";
  const myLineId = currentUser.line_user_id || currentUser.id || "";
  const myName = (currentUser.name || "").trim();

  return (
    (myDocId && report.assigned_to.docId === myDocId) ||
    (myLineId && report.assigned_to.line_user_id === myLineId) ||
    (myName && report.assigned_to.name === myName)
  );
}

// ============================================================================
// 3. แสดงการ์ดงานซ่อม (เรียงงานที่กำลังทำขึ้นก่อน)
// ============================================================================
function renderFixerJobCards() {
  const container = document.getElementById("fixerJobsContainer");
  if (!container) return;

  const isAdmin = (currentUser.role || "").toLowerCase() === "admin";
  const jobs = isAdmin ? [...allFixReports] : allFixReports.filter(isAssignedToCurrentUser);

  // เรียงงานที่กำลังทำ (assigned) ขึ้นก่อน ตามด้วยงานอื่นๆ
  const statusPriority = { assigned: 1, pending: 2, escalated: 3, done: 4, cancelled: 5 };
  jobs.sort((a, b) => (statusPriority[a.status] || 9) - (statusPriority[b.status] || 9));

  if (jobs.length === 0) {
    container.innerHTML = `
      <div class="col-12">
        <div class="card border-0 shadow-sm py-5 text-center text-muted">
          <i class="bi bi-clipboard-check fs-1 mb-2 text-secondary"></i>
          <div class="fw-semibold">ยังไม่มีรายการงานซ่อมที่ได้รับมอบหมาย</div>
        </div>
      </div>
    `;
    return;
  }

  const statusBadge = {
    pending: '<span class="badge bg-warning text-dark">รอจ่ายงาน</span>',
    assigned: '<span class="badge bg-info text-dark">กำลังดำเนินการซ่อม</span>',
    escalated: '<span class="badge bg-danger">ส่งต่อผู้เชี่ยวชาญ</span>',
    done: '<span class="badge bg-success">ซ่อมเสร็จสิ้น</span>',
    cancelled: '<span class="badge bg-secondary">ยกเลิก</span>'
  };

  container.innerHTML = jobs.map((d) => {
    const dateStr = d.created_at?.toDate
      ? d.created_at.toDate().toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" })
      : "-";

    const reportImgCount = Array.isArray(d.images) ? d.images.length : 0;
    const fixerImgCount = Array.isArray(d.fixer_images) ? d.fixer_images.length : 0;
    const assignedName = d.assigned_to?.name || "ยังไม่ระบุช่าง";

    return `
      <div class="col-12 col-lg-6">
        <div class="card border-0 shadow-sm h-100">
          <div class="card-header bg-white py-2 d-flex justify-content-between align-items-center">
            <div>
              <span class="fw-bold text-primary">${escapeHtml(d.wo_id)}</span>
              <span class="text-muted small ms-2"><i class="bi bi-clock me-1"></i>${dateStr}</span>
            </div>
            ${statusBadge[d.status] || statusBadge.pending}
          </div>

          <div class="card-body">
            <h6 class="fw-bold text-dark mb-1">
              <i class="bi bi-geo-alt-fill text-danger me-1"></i>${escapeHtml(d.location || "-")}
            </h6>
            <p class="small text-secondary mb-2">${escapeHtml(d.detail || "-")}</p>

            <div class="d-flex flex-wrap gap-3 small text-muted mb-2">
              <span><i class="bi bi-person me-1"></i>ผู้แจ้ง: <strong>${escapeHtml(d.reporter_name || "-")}</strong></span>
              <span><i class="bi bi-wrench me-1"></i>ผู้รับผิดชอบ: <strong>${escapeHtml(assignedName)}</strong></span>
            </div>

            ${d.admin_comment ? `
              <div class="alert alert-warning py-2 px-3 small mb-2">
                <i class="bi bi-chat-left-quote-fill me-1"></i><strong>คำสั่งจากผู้ดูแล:</strong> ${escapeHtml(d.admin_comment)}
              </div>
            ` : ""}

            ${d.fixer_note ? `
              <div class="alert alert-success py-2 px-3 small mb-2">
                <i class="bi bi-check2-square me-1"></i><strong>บันทึกช่าง:</strong> ${escapeHtml(d.fixer_note)}
              </div>
            ` : ""}
          </div>

          <div class="card-footer bg-white py-2 d-flex justify-content-between align-items-center flex-wrap gap-2">
            <div class="d-flex gap-1">
              <button type="button" class="btn btn-outline-primary btn-sm"
                      onclick="viewFixerImages('${d.wo_id}', 'report')" ${reportImgCount === 0 ? "disabled" : ""}>
                <i class="bi bi-images me-1"></i>รูปความเสียหาย (${reportImgCount})
              </button>
              ${fixerImgCount > 0 ? `
                <button type="button" class="btn btn-outline-success btn-sm"
                        onclick="viewFixerImages('${d.wo_id}', 'fixer')">
                  <i class="bi bi-camera-fill me-1"></i>รูปปิดงาน (${fixerImgCount})
                </button>
              ` : ""}
            </div>

            <button type="button" class="btn btn-success btn-sm fw-bold px-3"
                    onclick="openFixerActionModal('${d.wo_id}')">
              <i class="bi bi-clipboard-check me-1"></i>ส่งผลการซ่อม / ปิดงาน
            </button>
          </div>
        </div>
      </div>
    `;
  }).join("");
}

// ============================================================================
// 4. ดูรูปภาพประกอบ (ทั้งรูปความเสียหาย และรูปยืนยันหลังซ่อม 2 รูป)
// ============================================================================
window.viewFixerImages = function (woId, type = "report") {
  const report = allFixReports.find((r) => r.wo_id === woId);
  if (!report) return;

  const imgArray = type === "fixer" ? (report.fixer_images || []) : (report.images || []);
  const titlePrefix = type === "fixer" ? "รูปยืนยันผลการปฏิบัติงาน (2 รูป)" : "รูปภาพจุดชำรุดที่แจ้งซ่อม";

  if (imgArray.length === 0) {
    Swal.fire("ไม่พบรูปภาพ", "ไม่มีรูปภาพในส่วนนี้", "info");
    return;
  }

  const imagesHtml = imgArray.map((img, idx) => {
    const displayUrl = img.fileId
      ? `https://drive.google.com/thumbnail?id=${img.fileId}&sz=w1000`
      : img.url;
    const driveLink = img.webViewLink || img.url;

    return `
      <div class="col-12 col-md-6">
        <div class="card h-100 shadow-sm border">
          <a href="${driveLink}" target="_blank" rel="noopener noreferrer">
            <img src="${displayUrl}"
                 onerror="this.onerror=null; this.src='${img.url}';"
                 class="card-img-top"
                 style="height: 220px; object-fit: cover; background: #f8f9fa;"
                 alt="รูปที่ ${idx + 1}">
          </a>
          <div class="card-footer bg-white py-2 d-flex justify-content-between align-items-center">
            <span class="small text-muted">รูปที่ ${idx + 1}</span>
            <a href="${driveLink}" target="_blank" rel="noopener noreferrer" class="btn btn-sm btn-light border">
              <i class="bi bi-box-arrow-up-right me-1"></i>ขยายเต็มจอ
            </a>
          </div>
        </div>
      </div>
    `;
  }).join("");

  Swal.fire({
    title: `${titlePrefix} (${woId})`,
    html: `<div class="row g-3 text-start">${imagesHtml}</div>`,
    width: "820px",
    confirmButtonText: "ปิดหน้าต่าง",
    confirmButtonColor: "#0d233a"
  });
};

// ============================================================================
// 5. เปิด Modal ปิดงานซ่อม + ตรวจสอบรูปถ่ายยืนยัน 2 รูป
// ============================================================================
window.openFixerActionModal = function (woId) {
  const report = allFixReports.find((r) => r.wo_id === woId);
  if (!report) return;

  document.getElementById("fixerWorkWoId").value = report.wo_id;
  document.getElementById("fixerModalWoId").textContent = report.wo_id;
  document.getElementById("fixerModalLocation").textContent = report.location || "-";
  document.getElementById("fixerModalDetail").textContent = report.detail || "-";
  document.getElementById("fixerModalReporter").textContent = `${report.reporter_name || "-"} (${report.reporter_pos || "-"})`;

  const adminNoteBox = document.getElementById("fixerModalAdminNoteBox");
  const adminNoteText = document.getElementById("fixerModalAdminNoteText");
  if (report.admin_comment) {
    adminNoteText.textContent = report.admin_comment;
    adminNoteBox.classList.remove("d-none");
  } else {
    adminNoteBox.classList.add("d-none");
  }

  document.getElementById("outcomeDone").checked = report.status !== "escalated";
  document.getElementById("outcomeEscalated").checked = report.status === "escalated";
  document.getElementById("fixerNoteInput").value = report.fixer_note || "";

  fixerSelectedFiles = [];
  document.getElementById("fixerProofImages").value = "";
  renderFixerPreviewGrid();
  validateFixerForm();

  const historyBox = document.getElementById("fixerCommentHistory");
  const comments = Array.isArray(report.comments) ? report.comments : [];
  if (comments.length === 0) {
    historyBox.innerHTML = `<span class="text-muted">ยังไม่มีประวัติ Comment</span>`;
  } else {
    historyBox.innerHTML = comments.map((c) => `
      <div class="border-bottom pb-1 mb-1">
        <div class="d-flex justify-content-between">
          <strong class="text-primary">${escapeHtml(c.by_name || "-")} (${escapeHtml(c.by_role || "")})</strong>
          <span class="text-muted" style="font-size: 11px;">${escapeHtml(c.time_str || "")}</span>
        </div>
        <div>${escapeHtml(c.message || "")}</div>
      </div>
    `).join("");
  }

  const modalElem = document.getElementById("fixerActionModal");
  bootstrap.Modal.getOrCreateInstance(modalElem).show();
};

function handleFixerFileChange(event) {
  const files = Array.from(event.target.files || []).filter((f) => f.type.startsWith("image/"));

  if (files.length !== 2) {
    Swal.fire({
      icon: "warning",
      title: "กรุณาเลือกรูปภาพจำนวน 2 รูป",
      text: `คุณเลือกมา ${files.length} รูป ระบบกำหนดให้แนบรูปยืนยันจำนวน 2 รูปพอดีครับ`,
      confirmButtonColor: "#0d233a"
    });
  }

  fixerSelectedFiles = files.slice(0, 2);
  renderFixerPreviewGrid();
  validateFixerForm();
}

function renderFixerPreviewGrid() {
  const grid = document.getElementById("fixerPreviewGrid");
  if (!grid) return;

  if (fixerSelectedFiles.length === 0) {
    grid.innerHTML = "";
    return;
  }

  grid.innerHTML = fixerSelectedFiles.map((file, idx) => {
    const url = URL.createObjectURL(file);
    return `
      <div class="col-6 col-md-4">
        <div class="position-relative border rounded overflow-hidden shadow-sm bg-white">
          <img src="${url}" class="w-100" style="height: 120px; object-fit: cover;" alt="รูปยืนยัน ${idx + 1}">
          <span class="badge bg-dark position-absolute bottom-0 start-0 m-1">รูปที่ ${idx + 1}</span>
          <button type="button" class="btn btn-danger btn-sm position-absolute top-0 end-0 m-1 py-0 px-1"
                  onclick="removeFixerProofImage(${idx})">
            <i class="bi bi-x"></i>
          </button>
        </div>
      </div>
    `;
  }).join("");
}

window.removeFixerProofImage = function (idx) {
  fixerSelectedFiles.splice(idx, 1);
  if (fixerSelectedFiles.length === 0) {
    document.getElementById("fixerProofImages").value = "";
  }
  renderFixerPreviewGrid();
  validateFixerForm();
};

function validateFixerForm() {
  const note = document.getElementById("fixerNoteInput")?.value.trim();
  const btnSubmit = document.getElementById("btnSubmitFixerWork");
  const isValid = Boolean(note && fixerSelectedFiles.length === 2);
  if (btnSubmit) btnSubmit.disabled = !isValid;
}

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
        canvas.getContext("2d").drawImage(img, 0, 0, width, height);

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
// 6. อัปโหลดรูปยืนยัน 2 รูปเข้า Drive & บันทึกผลการซ่อมลง Firestore
// ============================================================================
async function handleSubmitFixerWork(event) {
  event.preventDefault();

  const woId = document.getElementById("fixerWorkWoId").value;
  const outcome = document.querySelector('input[name="repairOutcome"]:checked')?.value || "done";
  const fixerNote = document.getElementById("fixerNoteInput").value.trim();

  if (!fixerNote || fixerSelectedFiles.length !== 2) {
    Swal.fire("ข้อมูลไม่ครบถ้วน", "กรุณากรอกรายละเอียดการซ่อมและแนบรูปถ่ายยืนยันจำนวน 2 รูป", "warning");
    return;
  }

  if (!GAS_UPLOAD_WEBAPP_URL.startsWith("https://script.google.com/")) {
    Swal.fire("ยังไม่ได้ตั้งค่า GAS URL", "กรุณานำ URL ของ Google Apps Script มาใส่ในตัวแปร GAS_UPLOAD_WEBAPP_URL", "error");
    return;
  }

  Swal.fire({
    title: "กำลังบันทึกผลการปฏิบัติงาน...",
    html: "กำลังอัปโหลดรูปภาพยืนยัน 2 รูปไปยัง Google Drive กรุณารอสักครู่",
    allowOutsideClick: false,
    didOpen: () => Swal.showLoading()
  });

  try {
    const compressedFiles = await Promise.all(
      fixerSelectedFiles.map((file) => compressImageToBase64(file))
    );

    const gasRes = await fetch(GAS_UPLOAD_WEBAPP_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({
        prefix: `${woId}_FIXER`,
        files: compressedFiles
      })
    });

    const gasResult = await gasRes.json();
    if (!gasResult.success) {
      throw new Error(gasResult.message || "อัปโหลดรูปยืนยันไปยัง Google Drive ล้มเหลว");
    }

    const statusLabel = outcome === "done" ? "ซ่อมเสร็จสิ้น" : "ซ่อมไม่ได้ (ส่งต่อช่างผู้เชี่ยวชาญ)";
    const commentText = `[${statusLabel}] ${fixerNote}`;

    await updateDoc(doc(db, "fix_report", woId), {
      status: outcome,
      fixer_note: fixerNote,
      fixer_images: gasResult.files,
      completed_by: {
        docId: currentUser.docId || "",
        line_user_id: currentUser.line_user_id || currentUser.id || "",
        name: currentUser.name || "ช่างซ่อมบำรุง"
      },
      completed_at: serverTimestamp(),
      updated_at: serverTimestamp(),
      comments: arrayUnion({
        by_name: currentUser.name || "ช่างซ่อมบำรุง",
        by_role: "FIXER",
        message: commentText,
        time_str: new Date().toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" })
      })
    });

    await insertAuditLog("FIXER_SUBMIT_WORK", `ช่างส่งผลใบงาน ${woId}: ${commentText}`, currentUser);

    bootstrap.Modal.getInstance(document.getElementById("fixerActionModal"))?.hide();

    Swal.fire({
      icon: "success",
      title: outcome === "done" ? "บันทึกปิดงานซ่อมสำเร็จ!" : "บันทึกส่งต่อผู้เชี่ยวชาญสำเร็จ!",
      text: `อัปเดตสถานะใบงาน ${woId} พร้อมรูปยืนยัน 2 รูปเรียบร้อยแล้ว`,
      confirmButtonColor: "#0d233a"
    });

    await loadFixerJobs();
  } catch (error) {
    console.error("❌ บันทึกงานช่างล้มเหลว:", error);
    Swal.fire("เกิดข้อผิดพลาด", error.message, "error");
  }
}

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ============================================================================
// 7. INITIALIZATION
// ============================================================================
async function initializeFixerPage() {
  if (!initFixerAuth()) return;

  document.getElementById("btnRefreshFixer")?.addEventListener("click", loadFixerJobs);
  document.getElementById("fixerNoteInput")?.addEventListener("input", validateFixerForm);
  document.getElementById("fixerProofImages")?.addEventListener("change", handleFixerFileChange);
  document.getElementById("fixerActionForm")?.addEventListener("submit", handleSubmitFixerWork);

  await loadFixerJobs();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initializeFixerPage);
} else {
  initializeFixerPage();
}