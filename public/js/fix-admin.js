// public/js/fix-admin.js
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

let currentUser = null;
let allReports = [];
let committeesMapByLineId = {};
let fixersList = [];

// ============================================================================
// 1. ตรวจสอบสิทธิ์เข้าหน้าบริหารจัดการแจ้งซ่อม & แสดง Navbar
// ============================================================================
function initAdminAuth() {
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

  // แสดงโปรไฟล์บน Navbar
  const nameElem = document.getElementById("headerUserName");
  const posElem = document.getElementById("headerUserPosition");
  const roleElem = document.getElementById("headerUserRole");
  const imgElem = document.getElementById("headerUserImg");

  if (nameElem) nameElem.textContent = currentUser.name || "ผู้ใช้งาน";
  if (posElem) posElem.textContent = `ตำแหน่ง: ${currentUser.pos || currentUser.position || "บุคลากร"}`;
  if (roleElem) roleElem.textContent = `Role: ${(currentUser.role || "staff").toUpperCase()}`;
  if (imgElem && currentUser.picture) imgElem.src = currentUser.picture;

  // ตรวจสอบสิทธิ์ (Admin หรือผู้ที่มีสิทธิ์ kbsFixAdmin / kbsGmManage)
  const role = (currentUser.role || "").toLowerCase();
  const perms = Array.isArray(currentUser.general_permission) ? currentUser.general_permission : [];
  const canManage = role === "admin" || perms.includes("kbsFixAdmin") || perms.includes("kbsGmManage");

  if (!canManage) {
    Swal.fire({
      icon: "error",
      title: "ไม่มีสิทธิ์เข้าถึง",
      text: "คุณไม่ได้รับสิทธิ์เข้าถึงหน้าบริหารจัดการงานแจ้งซ่อม",
      confirmButtonColor: "#0d233a"
    }).then(() => {
      window.location.href = "index.html";
    });
    return false;
  }

  return true;
}

// ============================================================================
// 2. โหลดข้อมูลบุคลากร (สำหรับติดต่อผู้แจ้งซ่อม & ดึงรายชื่อช่าง fixer)
// ============================================================================
async function loadCommitteesAndFixers() {
  try {
    const snap = await getDocs(collection(db, "committees"));
    committeesMapByLineId = {};
    fixersList = [];

    snap.forEach((docSnap) => {
      const d = docSnap.data();
      const person = {
        docId: docSnap.id,
        line_user_id: d.line_user_id || "",
        name: d.name || d.comm_name || "ไม่ระบุชื่อ",
        pos: d.pos || d.position || "-",
        tel: d.tel || d.phone || d.mobile || "",
        role: (d.role || "staff").toLowerCase(),
        general_permission: Array.isArray(d.general_permission) ? d.general_permission : []
      };

      if (person.line_user_id) {
        committeesMapByLineId[person.line_user_id] = person;
      }

      // เก็บรายชื่อช่าง (ผู้ที่มีสิทธิ์ kbsFixer หรือเป็นช่าง/เจ้าหน้าที่)
      const isFixer = person.general_permission.includes("kbsFixer");
      fixersList.push({ ...person, isFixer });
    });

    // เรียงให้คนที่มีสิทธิ์ kbsFixer ขึ้นก่อน แล้วเรียงตามชื่อภาษาไทย
    fixersList.sort((a, b) => Number(b.isFixer) - Number(a.isFixer) || a.name.localeCompare(b.name, "th"));

    const selectFixer = document.getElementById("selectFixer");
    if (selectFixer) {
      selectFixer.innerHTML = `<option value="">-- ยังไม่ระบุช่างผู้รับผิดชอบ --</option>`;
      fixersList.forEach((f) => {
        const tag = f.isFixer ? "🔧 [ช่างซ่อม] " : "";
        const opt = document.createElement("option");
        opt.value = f.docId;
        opt.textContent = `${tag}${f.name} (${f.pos})`;
        selectFixer.appendChild(opt);
      });
    }
  } catch (error) {
    console.error("❌ โหลดข้อมูลบุคลากรล้มเหลว:", error);
  }
}

// ============================================================================
// 3. โหลดรายการแจ้งซ่อมทั้งหมดจาก Firestore 'fix_report'
// ============================================================================
async function loadAllFixReports() {
  const tbody = document.getElementById("adminFixTableBody");
  if (!tbody) return;

  try {
    const q = query(collection(db, "fix_report"), orderBy("created_at", "desc"));
    const snap = await getDocs(q);

    allReports = [];
    snap.forEach((docSnap) => {
      const d = docSnap.data();
      allReports.push({
        id: docSnap.id,
        wo_id: d.wo_id || docSnap.id,
        ...d
      });
    });

    updateSummaryCards();
    renderFilteredTable();
  } catch (error) {
    console.error("❌ โหลดรายการแจ้งซ่อมล้มเหลว:", error);
    tbody.innerHTML = `<tr><td colspan="7" class="text-center text-danger py-4">โหลดข้อมูลไม่สำเร็จ: ${error.message}</td></tr>`;
  }
}

function updateSummaryCards() {
  const counts = { total: allReports.length, pending: 0, assigned: 0, escalated: 0, done: 0, cancelled: 0 };
  allReports.forEach((r) => {
    const st = (r.status || "pending").toLowerCase();
    if (counts[st] !== undefined) counts[st]++;
  });

  document.getElementById("stat-total").textContent = counts.total;
  document.getElementById("stat-pending").textContent = counts.pending;
  document.getElementById("stat-assigned").textContent = counts.assigned;
  document.getElementById("stat-escalated").textContent = counts.escalated;
  document.getElementById("stat-done").textContent = counts.done;
  document.getElementById("stat-cancelled").textContent = counts.cancelled;
}

// ============================================================================
// 4. กรองข้อมูลและแสดงผลในตาราง
// ============================================================================
function renderFilteredTable() {
  const tbody = document.getElementById("adminFixTableBody");
  if (!tbody) return;

  const keyword = (document.getElementById("searchInput")?.value || "").trim().toLowerCase();
  const statusVal = document.getElementById("statusFilter")?.value || "all";

  const filtered = allReports.filter((item) => {
    const matchStatus = statusVal === "all" || (item.status || "pending") === statusVal;
    if (!matchStatus) return false;

    if (!keyword) return true;
    const searchPool = [
      item.wo_id,
      item.location,
      item.detail,
      item.reporter_name,
      item.assigned_to?.name || ""
    ].join(" ").toLowerCase();

    return searchPool.includes(keyword);
  });

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted py-5">ไม่พบรายการแจ้งซ่อมที่ตรงตามเงื่อนไข</td></tr>`;
    return;
  }

  const statusBadge = {
    pending: '<span class="badge bg-warning text-dark">รอรับเรื่อง / จ่ายงาน</span>',
    assigned: '<span class="badge bg-info text-dark">กำลังดำเนินการ</span>',
    escalated: '<span class="badge bg-danger">ส่งต่อผู้เชี่ยวชาญ</span>',
    done: '<span class="badge bg-success">ซ่อมเสร็จสิ้น</span>',
    cancelled: '<span class="badge bg-secondary">ยกเลิก</span>'
  };

  tbody.innerHTML = filtered.map((d) => {
    const dateStr = d.created_at?.toDate
      ? d.created_at.toDate().toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" })
      : "-";

    const reportImgCount = Array.isArray(d.images) ? d.images.length : 0;
    const fixerImgCount = Array.isArray(d.fixer_images) ? d.fixer_images.length : 0;

    const assignedHtml = d.assigned_to?.name
      ? `<div class="fw-semibold text-dark small"><i class="bi bi-person-badge text-primary me-1"></i>${escapeHtml(d.assigned_to.name)}</div>`
      : `<span class="text-muted small fst-italic">ยังไม่มอบหมายช่าง</span>`;

    const commentPreview = d.admin_comment
      ? `<div class="text-muted small mt-1 text-truncate" style="max-width: 220px;" title="${escapeHtml(d.admin_comment)}">
           <i class="bi bi-chat-dots text-primary me-1"></i>${escapeHtml(d.admin_comment)}
         </div>`
      : "";

    return `
      <tr>
        <td>
          <div class="fw-bold text-primary small">${escapeHtml(d.wo_id)}</div>
          <div class="text-muted" style="font-size: 11px;">${dateStr}</div>
        </td>
        <td>
          <div class="fw-semibold small">${escapeHtml(d.reporter_name || "-")}</div>
          <div class="text-muted" style="font-size: 11px;">${escapeHtml(d.reporter_pos || "-")}</div>
          <button type="button" class="btn btn-outline-success btn-sm py-0 px-2 mt-1" style="font-size: 11px;"
                  onclick="contactReporter('${d.wo_id}')">
            <i class="bi bi-telephone-outbound me-1"></i>ติดต่อผู้แจ้ง
          </button>
        </td>
        <td>
          <div class="fw-semibold small text-dark"><i class="bi bi-geo-alt-fill text-danger me-1"></i>${escapeHtml(d.location || "-")}</div>
          <div class="small text-secondary mt-1">${escapeHtml(d.detail || "-")}</div>
        </td>
        <td>
          <div class="d-flex flex-column gap-1">
            <button type="button" class="btn btn-sm btn-outline-primary py-0 px-2" style="font-size: 12px;"
                    onclick="viewAdminImages('${d.wo_id}', 'report')" ${reportImgCount === 0 ? "disabled" : ""}>
              <i class="bi bi-images me-1"></i>รูปแจ้ง (${reportImgCount})
            </button>
            ${fixerImgCount > 0 ? `
              <button type="button" class="btn btn-sm btn-outline-success py-0 px-2" style="font-size: 12px;"
                      onclick="viewAdminImages('${d.wo_id}', 'fixer')">
                <i class="bi bi-check2-circle me-1"></i>รูปเสร็จ (${fixerImgCount})
              </button>
            ` : ""}
          </div>
        </td>
        <td>
          ${assignedHtml}
          ${commentPreview}
        </td>
        <td>${statusBadge[d.status] || statusBadge.pending}</td>
        <td class="text-center">
          <button type="button" class="btn btn-primary btn-sm fw-semibold px-2" onclick="openAssignModal('${d.wo_id}')">
            <i class="bi bi-pencil-square me-1"></i>จัดการ
          </button>
        </td>
      </tr>
    `;
  }).join("");
}

// ============================================================================
// 5. ติดต่อผู้แจ้งซ่อม (ดึงเบอร์โทร/ข้อมูลจาก committees)
// ============================================================================
window.contactReporter = function (woId) {
  const report = allReports.find((r) => r.wo_id === woId);
  if (!report) return;

  const profile = committeesMapByLineId[report.line_user_id] || {};
  const tel = profile.tel || "ไม่ได้บันทึกเบอร์โทรในระบบ";
  const hasTel = Boolean(profile.tel);

  Swal.fire({
    title: "ข้อมูลติดต่อผู้แจ้งซ่อม",
    html: `
      <div class="text-start p-3 bg-light rounded border">
        <p class="mb-2"><strong>เลขที่ใบงาน:</strong> <span class="text-primary fw-bold">${escapeHtml(report.wo_id)}</span></p>
        <p class="mb-2"><strong>ชื่อ-สกุล:</strong> ${escapeHtml(report.reporter_name || "-")}</p>
        <p class="mb-2"><strong>ตำแหน่ง:</strong> ${escapeHtml(report.reporter_pos || profile.pos || "-")}</p>
        <p class="mb-2"><strong>สถานที่แจ้งซ่อม:</strong> ${escapeHtml(report.location || "-")}</p>
        <p class="mb-0"><strong>เบอร์โทรศัพท์:</strong> <span class="fw-bold text-success">${escapeHtml(tel)}</span></p>
      </div>
      ${hasTel ? `
        <div class="mt-3 d-grid">
          <a href="tel:${escapeHtml(tel)}" class="btn btn-success fw-bold">
            <i class="bi bi-telephone-fill me-2"></i>โทรออกหา ${escapeHtml(report.reporter_name)}
          </a>
        </div>
      ` : ""}
    `,
    confirmButtonText: "ปิดหน้าต่าง",
    confirmButtonColor: "#0d233a"
  });
};

// ============================================================================
// 6. ดูรูปภาพประกอบ (ทั้งรูปตอนแจ้งซ่อม และรูปยืนยันหลังซ่อม 2 รูปจากช่าง)
// ============================================================================
window.viewAdminImages = function (woId, type = "report") {
  const report = allReports.find((r) => r.wo_id === woId);
  if (!report) return;

  const imgArray = type === "fixer" ? (report.fixer_images || []) : (report.images || []);
  const titlePrefix = type === "fixer" ? "รูปภาพหลังดำเนินการซ่อม" : "รูปภาพความเสียหายตอนแจ้ง";

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
              <i class="bi bi-box-arrow-up-right me-1"></i>เปิดรูปเต็ม
            </a>
          </div>
        </div>
      </div>
    `;
  }).join("");

  Swal.fire({
    title: `${titlePrefix} (${woId})`,
    html: `
      <div class="text-start mb-3 p-2 bg-light rounded border small">
        <div><strong>สถานที่:</strong> ${escapeHtml(report.location || "-")}</div>
        <div><strong>อาการ:</strong> ${escapeHtml(report.detail || "-")}</div>
      </div>
      <div class="row g-3 text-start">${imagesHtml}</div>
    `,
    width: "820px",
    confirmButtonText: "ปิดหน้าต่าง",
    confirmButtonColor: "#0d233a"
  });
};

// ============================================================================
// 7. เปิด Modal จ่ายงาน & Comment ไปยังช่าง (fixer)
// ============================================================================
window.openAssignModal = function (woId) {
  const report = allReports.find((r) => r.wo_id === woId);
  if (!report) return;

  document.getElementById("editWoId").value = report.wo_id;
  document.getElementById("modalWoId").textContent = report.wo_id;
  document.getElementById("modalReporterInfo").textContent = `${report.reporter_name || "-"} (${report.reporter_pos || "-"})`;
  document.getElementById("modalLocation").textContent = report.location || "-";
  document.getElementById("modalDetail").textContent = report.detail || "-";

  // ตั้งค่าช่างที่เคยมอบหมายไว้ (ถ้ามี)
  const selectFixer = document.getElementById("selectFixer");
  if (selectFixer) {
    selectFixer.value = report.assigned_to?.docId || "";
  }

  // ตั้งค่าสถานะปัจจุบัน
  const selectStatus = document.getElementById("selectWorkStatus");
  if (selectStatus) {
    selectStatus.value = report.status || "pending";
  }

  // เคลียร์ช่องพิมพ์ Comment ใหม่ แต่โหลดข้อความแจ้งผู้แจ้งเดิมมาแสดง
  document.getElementById("adminCommentInput").value = "";
  document.getElementById("reporterFeedbackInput").value = report.reporter_feedback || "";

  // แสดงประวัติ Comment ทั้งหมด
  const historyBox = document.getElementById("commentHistoryBox");
  const comments = Array.isArray(report.comments) ? report.comments : [];
  if (comments.length === 0) {
    historyBox.innerHTML = `<span class="text-muted">ยังไม่มีประวัติ Comment</span>`;
  } else {
    historyBox.innerHTML = comments.map((c) => `
      <div class="border-bottom pb-1 mb-1">
        <div class="d-flex justify-content-between">
          <strong class="text-primary">${escapeHtml(c.by_name || "ผู้ดูแล")} (${escapeHtml(c.by_role || "")})</strong>
          <span class="text-muted" style="font-size: 11px;">${escapeHtml(c.time_str || "")}</span>
        </div>
        <div>${escapeHtml(c.message || "")}</div>
      </div>
    `).join("");
  }

  const modalElem = document.getElementById("assignWorkModal");
  const bsModal = bootstrap.Modal.getOrCreateInstance(modalElem);
  bsModal.show();
};

// เมื่อเลือกช่างใน Dropdown ถ้าสถานะยังเป็น pending ให้ปรับเป็น assigned อัตโนมัติ
document.getElementById("selectFixer")?.addEventListener("change", (e) => {
  const statusSelect = document.getElementById("selectWorkStatus");
  if (e.target.value && statusSelect && statusSelect.value === "pending") {
    statusSelect.value = "assigned";
  }
});

// บันทึกการจ่ายงานและ Comment ลง Firestore 'fix_report'
async function handleSaveWorkOrder(event) {
  event.preventDefault();

  const woId = document.getElementById("editWoId").value;
  const fixerDocId = document.getElementById("selectFixer").value;
  const newStatus = document.getElementById("selectWorkStatus").value;
  const newComment = document.getElementById("adminCommentInput").value.trim();
  const reporterFeedback = document.getElementById("reporterFeedbackInput").value.trim();

  const report = allReports.find((r) => r.wo_id === woId);
  if (!report) return;

  const btnSave = document.getElementById("btnSaveWorkOrder");
  if (btnSave) {
    btnSave.disabled = true;
    btnSave.innerHTML = `<span class="spinner-border spinner-border-sm me-1"></span>กำลังบันทึก...`;
  }

  try {
    let assignedObj = null;
    if (fixerDocId) {
      const fixer = fixersList.find((f) => f.docId === fixerDocId);
      if (fixer) {
        assignedObj = {
          docId: fixer.docId,
          line_user_id: fixer.line_user_id,
          name: fixer.name,
          pos: fixer.pos
        };
      }
    }

    const updatePayload = {
      status: newStatus,
      assigned_to: assignedObj,
      reporter_feedback: reporterFeedback,
      updated_at: serverTimestamp()
    };

    if (newComment) {
      updatePayload.admin_comment = newComment;
      updatePayload.comments = arrayUnion({
        by_name: currentUser.name || "ผู้ดูแลระบบ",
        by_role: (currentUser.role || "admin").toUpperCase(),
        message: newComment,
        time_str: new Date().toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" })
      });
    }

    await updateDoc(doc(db, "fix_report", woId), updatePayload);

    const logMsg = `อัปเดตใบงาน ${woId} สถานะ: ${newStatus}` +
      (assignedObj ? ` | มอบหมาย: ${assignedObj.name}` : "") +
      (newComment ? ` | Comment: ${newComment}` : "");
    await insertAuditLog("UPDATE_FIX_ORDER", logMsg, currentUser);

    bootstrap.Modal.getInstance(document.getElementById("assignWorkModal"))?.hide();

    Swal.fire({
      icon: "success",
      title: "บันทึกใบงานสำเร็จ",
      text: assignedObj ? `ส่งงานและคำสั่งไปยัง ${assignedObj.name} เรียบร้อยแล้ว` : "อัปเดตสถานะใบงานเรียบร้อยแล้ว",
      timer: 1600,
      showConfirmButton: false
    });

    await loadAllFixReports();
  } catch (error) {
    console.error("❌ บันทึกใบงานล้มเหลว:", error);
    Swal.fire("เกิดข้อผิดพลาด", error.message, "error");
  } finally {
    if (btnSave) {
      btnSave.disabled = false;
      btnSave.innerHTML = `<i class="bi bi-save me-1"></i> บันทึกและส่งงานช่าง`;
    }
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
// 8. INITIALIZATION
// ============================================================================
async function initializeFixAdmin() {
  if (!initAdminAuth()) return;

  document.getElementById("searchInput")?.addEventListener("input", renderFilteredTable);
  document.getElementById("statusFilter")?.addEventListener("change", renderFilteredTable);
  document.getElementById("btnRefreshAdmin")?.addEventListener("click", loadAllFixReports);
  document.getElementById("assignWorkForm")?.addEventListener("submit", handleSaveWorkOrder);

  await loadCommitteesAndFixers();
  await loadAllFixReports();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initializeFixAdmin);
} else {
  initializeFixAdmin();
}