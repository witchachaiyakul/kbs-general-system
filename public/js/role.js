// public/js/role.js
import "./auth-guard.js";
import { db, insertAuditLog } from "./firestore.js";
import { 
    collection, 
    getDocs, 
    doc, 
    updateDoc,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// รายการเมนูทั้งหมดของระบบบริหารทั่วไป (ตรงกับ data-menu-id ใน index.html)
// รายการเมนูทั้งหมดของระบบบริหารทั่วไป (ตรงกับ data-menu-id ใน index.html)
const ALL_MENUS = [
    { id: 'kbsroom', name: 'จองห้องประชุม / สถานที่', icon: 'bi-calendar-check-fill' },
    { id: 'kbsRepair', name: 'แจ้งซ่อม', icon: 'bi-tools' },
    { id: 'kbsFixAdmin', name: 'บริหารจัดการงานแจ้งซ่อม', icon: 'bi-clipboard2-check-fill' },
    { id: 'kbsFixer', name: 'งานซ่อมของช่าง (Fixer)', icon: 'bi-wrench-adjustable-circle-fill' },
    { id: 'kbsGmManage', name: 'กำหนดสิทธิการใช้งาน', icon: 'bi-shield-lock-fill' }
];

// 🎯 ค่าเริ่มต้น (Default) ของแต่ละ Role เมื่อแอดมินกดเปลี่ยนใน Dropdown
const DEFAULT_GENERAL_PERMISSIONS = {
    admin: ['kbsroom', 'kbsRepair', 'kbsFixAdmin', 'kbsFixer', 'kbsGmManage'],
    officer: ['kbsroom', 'kbsRepair'],
    staff: ['kbsroom', 'kbsRepair']
};

let usersCache = [];
let activeEditingUid = null;
let currentUser = null;

// ============================================================================
// 🛡️ ตรวจสอบสิทธิ์ผู้ดูแลระบบ (Admin Guard) & แสดง Navbar
// ============================================================================
const isLocal = ["localhost", "127.0.0.1"].includes(window.location.hostname);
const MAIN_PORTAL_URL = isLocal ? "index.html" : "https://kbs-gm.web.app/";

function initAuthSession() {
    const userSessionStr = sessionStorage.getItem("kbs_user");
    if (!userSessionStr) {
        window.location.href = `${MAIN_PORTAL_URL}?redirect=${encodeURIComponent(window.location.href)}`;
        return false;
    }

    try {
        currentUser = JSON.parse(userSessionStr);
    } catch (e) {
        sessionStorage.removeItem("kbs_user");
        window.location.href = MAIN_PORTAL_URL;
        return false;
    }

    const perms = Array.isArray(currentUser.general_permission) ? currentUser.general_permission : [];
    const hasManageAccess = perms.includes("kbsGmManage") || (currentUser.role || "").toLowerCase() === "admin";

    if (!hasManageAccess) {
        Swal.fire({
            icon: 'error',
            title: 'ไม่มีสิทธิ์เข้าถึง',
            text: 'คุณไม่ได้รับสิทธิ์เข้าถึงเมนูจัดการสิทธิการใช้งาน',
            confirmButtonColor: '#0f172a'
        }).then(() => {
            window.location.href = "index.html";
        });
        return false;
    }

    // แสดงข้อมูลบน Navbar
    const nameElem = document.getElementById("headerUserName");
    const posElem = document.getElementById("headerUserPosition");
    const roleElem = document.getElementById("headerUserRole");
    const imgElem = document.getElementById("headerUserImg");

    if (nameElem) nameElem.textContent = currentUser.name || "ผู้ใช้งาน";
    if (posElem) posElem.textContent = `ตำแหน่ง: ${currentUser.pos || currentUser.position || "บุคลากร"}`;
    if (roleElem) roleElem.textContent = `Role: ${(currentUser.role || "staff").toUpperCase()}`;
    if (imgElem && currentUser.picture) imgElem.src = currentUser.picture;

    return true;
}
/**
 * 🔄 โหลดรายชื่อบุคลากรทั้งหมดจาก collection 'committees'
 */
export async function loadUsersTable() {
    const tbody = document.getElementById("userManagementTableBody");
    if (!tbody) return;

    tbody.innerHTML = `
        <tr>
            <td colspan="7" class="py-4 text-muted">
                <div class="spinner-border spinner-border-sm text-primary me-2" role="status"></div>
                กำลังดึงข้อมูลรายชื่อบุคลากร...
            </td>
        </tr>
    `;

    try {
        const committeesSnap = await getDocs(collection(db, "committees"));
        usersCache = [];

        committeesSnap.forEach((docSnap) => {
            const data = docSnap.data();
            const uid = docSnap.id;
            const role = (data.role || "staff").toLowerCase();
            const hasSavedPerms = Array.isArray(data.general_permission);

            // ถ้าเคยบันทึก general_permission แล้วให้ใช้ค่านั้น ถ้ายังไม่เคยให้ใส่ค่า Default ตาม Role
            let savedPerms = hasSavedPerms
                ? data.general_permission
                : [...(DEFAULT_GENERAL_PERMISSIONS[role] || DEFAULT_GENERAL_PERMISSIONS.staff)];

            if (role === 'admin') {
                savedPerms = [...DEFAULT_GENERAL_PERMISSIONS.admin];
            }

            usersCache.push({
                id: uid,
                name: data.name || data.comm_name || "ไม่ระบุชื่อ",
                pos: data.pos || data.position || "-",
                role: role,
                general_permission: savedPerms,
                line_user_id: data.line_user_id || "",
                isAssigned: hasSavedPerms || Boolean(data.role)
            });
        });

        // เรียงรายชื่อตามตัวอักษรภาษาไทย
        usersCache.sort((a, b) => a.name.localeCompare(b.name, "th"));

        if (usersCache.length === 0) {
            tbody.innerHTML = `<tr><td colspan="7" class="py-4 text-muted">ไม่พบข้อมูลบุคลากรในระบบ</td></tr>`;
            return;
        }

        let html = "";
        usersCache.forEach((user, idx) => {
            const uid = user.id;
            const currentRole = user.role;
            const userPerms = user.general_permission;

            html += `
                <tr>
                    <td>${idx + 1}</td>
                    <td class="text-start fw-bold text-navy">
                        ${escapeHtml(user.name)}
                        ${user.line_user_id ? '<i class="bi bi-line text-success ms-1" title="เชื่อมต่อ LINE แล้ว"></i>' : ''}
                    </td>
                    <td class="text-start small text-muted">${escapeHtml(user.pos)}</td>
                    <td>
                        <select class="form-select form-select-sm border-primary fw-bold" id="role_select_${uid}" onchange="handleRoleChange('${uid}')">
                            <option value="admin" ${currentRole === 'admin' ? 'selected' : ''}>👑 Admin (ทุกเมนู)</option>
                            <option value="officer" ${currentRole === 'officer' ? 'selected' : ''}>💼 Officer (เจ้าหน้าที่)</option>
                            <option value="staff" ${currentRole === 'staff' ? 'selected' : ''}>👤 Staff (บุคลากรทั่วไป)</option>
                        </select>
                    </td>
                    <td>
                        <button type="button" class="btn btn-outline-secondary btn-sm fw-bold px-2" id="btn_perm_${uid}" 
                                onclick="openPermissionsModal('${uid}')" ${currentRole === 'admin' ? 'disabled' : ''}>
                            <i class="bi bi-sliders me-1"></i> 
                            <span id="perm_badge_${uid}">${currentRole === 'admin' ? `ทุกเมนู (${ALL_MENUS.length})` : (userPerms.length > 0 ? `${userPerms.length} เมนู` : 'ตั้งค่าสิทธิ์')}</span>
                        </button>
                    </td>
                    <td>
                        ${user.isAssigned 
                            ? '<span class="badge bg-success">กำหนดสิทธิ์แล้ว</span>' 
                            : '<span class="badge bg-warning text-dark">ค่าเริ่มต้น</span>'}
                    </td>
                    <td>
                        <button type="button" id="btn_save_${uid}" class="btn btn-primary btn-sm fw-bold px-3" 
                                onclick="updateUserRole('${uid}')">
                            <i class="bi bi-save me-1"></i> บันทึก
                        </button>
                    </td>
                </tr>
            `;
        });

        tbody.innerHTML = html;
    } catch (error) {
        console.error("❌ Error loadUsersTable:", error);
        tbody.innerHTML = `
            <tr>
                <td colspan="7" class="py-4 text-danger">
                    <i class="bi bi-exclamation-triangle-fill me-1"></i> เกิดข้อผิดพลาดในการโหลดข้อมูล: ${error.message}
                </td>
            </tr>
        `;
    }
}

/**
 * ⚙️ เมื่อเปลี่ยน Role ใน Dropdown -> ตั้งค่าเมนูเริ่มต้น (Default) ตาม Role อัตโนมัติ
 */
export function handleRoleChange(uid) {
    const selectElem = document.getElementById(`role_select_${uid}`);
    const btnPerm = document.getElementById(`btn_perm_${uid}`);
    const badgeSpan = document.getElementById(`perm_badge_${uid}`);
    if (!selectElem || !btnPerm) return;

    const selectedRole = selectElem.value.toLowerCase();
    const user = usersCache.find(u => u.id === uid);

    const defaultPerms = [...(DEFAULT_GENERAL_PERMISSIONS[selectedRole] || [])];
    if (user) {
        user.role = selectedRole;
        user.general_permission = defaultPerms;
    }

    if (selectedRole === 'admin') {
        btnPerm.disabled = true;
        if (badgeSpan) badgeSpan.innerText = `ทุกเมนู (${ALL_MENUS.length})`;
    } else {
        btnPerm.disabled = false;
        if (badgeSpan) {
            badgeSpan.innerText = defaultPerms.length > 0 ? `${defaultPerms.length} เมนู` : 'ตั้งค่าสิทธิ์';
        }
    }
}

/**
 * 🎛️ เปิด Pop-up Modal ตั้งค่าสิทธิ์เมนูรายบุคคล
 */
export function openPermissionsModal(uid) {
    const user = usersCache.find(u => u.id === uid);
    if (!user) return;

    activeEditingUid = uid;
    const activePerms = user.general_permission || [];

    const labelName = document.getElementById('permUserName');
    if (labelName) labelName.innerText = `ผู้ใช้งาน: ${user.name} (${user.pos})`;

    const container = document.getElementById('permissionCheckboxesList');
    if (!container) return;

    let html = '';
    ALL_MENUS.forEach(menu => {
        const isChecked = activePerms.includes(menu.id);
        html += `
            <div class="form-check form-switch p-2 rounded border bg-light">
                <input class="form-check-input ms-0 me-2" type="checkbox" role="switch" 
                       id="chk_perm_${menu.id}" value="${menu.id}" ${isChecked ? 'checked' : ''}>
                <label class="form-check-label fw-bold text-dark" for="chk_perm_${menu.id}">
                    <i class="bi ${menu.icon} me-1 text-primary"></i> ${menu.name}
                </label>
            </div>
        `;
    });

    container.innerHTML = html;

    const modalElem = document.getElementById('permissionsModal');
    if (modalElem) {
        const bsModal = new bootstrap.Modal(modalElem);
        bsModal.show();
    }
}

/**
 * 💾 ยืนยันสิทธิ์จาก Modal
 */
export function savePermissionsFromModal() {
    if (!activeEditingUid) return;

    const selectedPerms = [];
    ALL_MENUS.forEach(menu => {
        const chk = document.getElementById(`chk_perm_${menu.id}`);
        if (chk && chk.checked) {
            selectedPerms.push(menu.id);
        }
    });

    const user = usersCache.find(u => u.id === activeEditingUid);
    if (user) {
        user.general_permission = selectedPerms;
    }

    const badgeSpan = document.getElementById(`perm_badge_${activeEditingUid}`);
    if (badgeSpan) {
        badgeSpan.innerText = selectedPerms.length > 0 ? `${selectedPerms.length} เมนู` : 'ตั้งค่าสิทธิ์';
    }

    const modalElem = document.getElementById('permissionsModal');
    if (modalElem) {
        const modalInstance = bootstrap.Modal.getInstance(modalElem);
        if (modalInstance) modalInstance.hide();
    }
}

/**
 * 💾 บันทึกสิทธิ์ลงใน Firestore collection 'committees'
 */
export async function updateUserRole(uid) {
    const selectElem = document.getElementById(`role_select_${uid}`);
    const btnSave = document.getElementById(`btn_save_${uid}`);
    const user = usersCache.find(u => u.id === uid);
    if (!selectElem || !user) return;

    const newRole = selectElem.value.toLowerCase();
    const finalPermissions = newRole === 'admin'
        ? [...DEFAULT_GENERAL_PERMISSIONS.admin]
        : (user.general_permission || []);

    if (btnSave) {
        btnSave.disabled = true;
        btnSave.innerHTML = `<span class="spinner-border spinner-border-sm me-1" role="status"></span> กำลังบันทึก...`;
    }

    try {
        await updateDoc(doc(db, "committees", uid), {
            role: newRole,
            general_permission: finalPermissions,
            updated_at: serverTimestamp()
        });

        if (typeof insertAuditLog === "function" && currentUser) {
            await insertAuditLog(
                "UPDATE_ROLE",
                `กำหนดสิทธิ์ ${user.name} เป็น ${newRole.toUpperCase()} (เมนู: ${finalPermissions.join(", ")})`,
                currentUser
            );
        }

        Swal.fire({
            icon: 'success',
            title: 'บันทึกสิทธิ์สำเร็จ',
            text: `อัปเดตสิทธิ์ของ "${user.name}" เรียบร้อยแล้ว`,
            confirmButtonColor: '#0f172a',
            timer: 1600,
            showConfirmButton: false
        });

        await loadUsersTable();

    } catch (error) {
        console.error("❌ Error updateUserRole:", error);
        Swal.fire({
            icon: 'error',
            title: 'เกิดข้อผิดพลาด',
            text: 'ไม่สามารถบันทึกสิทธิ์ได้: ' + error.message,
            confirmButtonColor: '#0f172a'
        });
    } finally {
        if (btnSave) {
            btnSave.disabled = false;
            btnSave.innerHTML = `<i class="bi bi-save me-1"></i> บันทึก`;
        }
    }
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/'/g, "\\'")
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

export function resetFormToMain() {
    window.location.href = "index.html";
}

function startRolePage() {
    if (!initAuthSession()) return;
    loadUsersTable();
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", startRolePage);
} else {
    startRolePage();
}

window.loadUsersTable = loadUsersTable;
window.handleRoleChange = handleRoleChange;
window.openPermissionsModal = openPermissionsModal;
window.savePermissionsFromModal = savePermissionsFromModal;
window.updateUserRole = updateUserRole;
window.resetFormToMain = resetFormToMain;