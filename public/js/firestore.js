// public/js/firestore.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { 
    getFirestore, 
    doc, 
    getDoc,
    updateDoc,
    collection, 
    query, 
    where, 
    getDocs,
    setDoc,
    serverTimestamp 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// Firebase Web Configuration
const firebaseConfig = {
    apiKey: "AIzaSyAKSRFvMlS-ZYgnGw8Ik3F34NUU9udw9tw",
    authDomain: "studio-1060072528-ff5ab.firebaseapp.com",
    projectId: "studio-1060072528-ff5ab",
    storageBucket: "studio-1060072528-ff5ab.firebasestorage.app",
    messagingSenderId: "311847661185",
    appId: "1:311847661185:web:94a67d92acc656c3b2e780"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);

// ============================================================================
// 🛡️ USER PERMISSIONS (COMMITTEES) & AUDIT LOGS
// ============================================================================

/**
 * 🔍 ดึงสิทธิ์เฉพาะของระบบบริหารทั่วไป (role และ general_permission) จากคอลเลกชัน 'committees'
 */
export async function fetchGeneralUserPermissions(docId, lineUserId, fallbackRole = "staff") {
    const extractPerms = (d) => ({
        role: (d.role || fallbackRole).toLowerCase(),
        general_permission: Array.isArray(d.general_permission)
            ? d.general_permission
            : (Array.isArray(d.permissions) ? d.permissions : undefined)
    });

    try {
        if (docId) {
            const userSnap = await getDoc(doc(db, "committees", docId));
            if (userSnap.exists()) return extractPerms(userSnap.data());
        }

        if (lineUserId) {
            const q = query(collection(db, "committees"), where("line_user_id", "==", lineUserId));
            const snap = await getDocs(q);
            if (!snap.empty) return extractPerms(snap.docs[0].data());
        }
    } catch (err) {
        console.warn("⚠️ ดึงสิทธิ์จาก committees ไม่สำเร็จ ใช้สิทธิ์พื้นฐานแทน:", err);
    }

    return { role: fallbackRole.toLowerCase(), general_permission: undefined };
}

/**
 * ตรวจสอบสิทธิ์ผู้ใช้งานจาก LINE User ID ใน collection 'committees'
 */
export async function getCommitteeByLineId(lineUserId) {
    try {
        const q = query(
            collection(db, "committees"), 
            where("line_user_id", "==", lineUserId)
        );
        const querySnapshot = await getDocs(q);

        if (!querySnapshot.empty) {
            const docSnap = querySnapshot.docs[0];
            return {
                docId: docSnap.id,
                ...docSnap.data()
            };
        }
        return null;
    } catch (error) {
        console.error("❌ ค้นหา committee จาก line_user_id ล้มเหลว:", error);
        return null;
    }
}

/**
 * ดึงรายชื่อบุคลากร/กรรมการที่ยังไม่ได้ลงทะเบียน (status != 'done' และยังไม่มี line_user_id)
 */
export async function getUnregisteredCommittees() {
    try {
        const querySnapshot = await getDocs(collection(db, "committees"));
        const list = [];
        querySnapshot.forEach((docSnap) => {
            const data = docSnap.data();
            if (data.status !== "done" && !data.line_user_id) {
                list.push({
                    docId: docSnap.id,
                    name: data.name || "",
                    pos: data.pos || "",
                    role: data.role || "staff"
                });
            }
        });
        return list;
    } catch (error) {
        console.error("❌ ดึงรายชื่อกรรมการล้มเหลว:", error);
        return [];
    }
}

/**
 * ผูกบัญชี LINE ID กับรายชื่อบุคลากร และอัปเดต status เป็น 'done'
 */
export async function registerCommitteeLineId(docId, lineUserId) {
    try {
        const committeeRef = doc(db, "committees", docId);
        await updateDoc(committeeRef, {
            line_user_id: lineUserId,
            status: "done",
            updated_at: serverTimestamp()
        });
        
        const updatedSnap = await getDoc(committeeRef);
        return {
            docId: updatedSnap.id,
            ...updatedSnap.data()
        };
    } catch (error) {
        console.error("❌ ผูกบัญชี LINE ล้มเหลว:", error);
        throw error;
    }
}

/**
 * บันทึก Audit Log ลง Firestore collection 'audit_logs'
 */
export async function insertAuditLog(actionType, detailsTxt, lineUserObj) {
    try {
        const logDocId = `LOG_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
        const logRef = doc(db, "audit_logs", logDocId);

        await setDoc(logRef, {
            timestamp: serverTimestamp(),
            action: actionType,
            details: detailsTxt,
            user_id: lineUserObj ? (lineUserObj.line_user_id || lineUserObj.id || "System") : "System",
            user_name: lineUserObj ? (lineUserObj.name || "Unknown") : "Unknown",
            user_picture: lineUserObj ? (lineUserObj.picture || "") : ""
        });
        console.log(`✅ Audit Log Saved: [${actionType}] ${detailsTxt}`);
    } catch (error) {
        console.error("❌ บันทึก Audit Log ล้มเหลว:", error);
    }
}

/**
 * ดึงรายการสถานที่/ห้องประชุมทั้งหมดจาก collection 'kbs_place'
 */
export async function getKbsPlaces() {
    try {
        const querySnapshot = await getDocs(collection(db, "kbs_place"));
        const places = [];

        querySnapshot.forEach((docSnap) => {
            const data = docSnap.data();
            if (data.active === false) return;

            places.push({
                ...data,
                id: String(data.id || docSnap.id),
                name: String(data.name || docSnap.id),
                order: typeof data.order === "number" ? data.order : 999
            });
        });

        // เรียงตาม order (ถ้ามี) -> ตามรหัส id (11018, 11019...) -> ตามชื่อภาษาไทย
        places.sort((a, b) => 
            a.order - b.order || 
            a.id.localeCompare(b.id, undefined, { numeric: true }) || 
            a.name.localeCompare(b.name, "th")
        );
        return places;
    } catch (error) {
        console.error("❌ ดึงข้อมูลสถานที่จาก kbs_place ล้มเหลว:", error);
        return [];
    }
}