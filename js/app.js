import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  getFirestore, collection, doc, getDoc, getDocs, setDoc, updateDoc,
  deleteDoc, query, where, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const $ = (id) => document.getElementById(id);
const state = { doctors: [], patients: [], bindings: [], admins: [] };

function text(v) { return v ?? ""; }
function nameOf(x) { return x.name || x.displayName || x.fullName || x.email || x.id; }
function escapeHtml(v) {
  return String(v ?? "").replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
}
function showMessage(id, message, ok=false) {
  const el = $(id); el.textContent = message; el.style.color = ok ? "#18794e" : "#c0392b";
}

$("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  showMessage("loginMessage", "登入中…", true);
  try {
    await signInWithEmailAndPassword(auth, $("loginEmail").value.trim(), $("loginPassword").value);
  } catch (err) {
    showMessage("loginMessage", "登入失敗：" + err.message);
  }
});

$("logoutBtn").addEventListener("click", () => signOut(auth));

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    $("loginView").classList.remove("hidden");
    $("appView").classList.add("hidden");
    return;
  }

  const adminSnap = await getDoc(doc(db, "admins", user.uid));
  if (!adminSnap.exists() || adminSnap.data().disabled === true) {
    await signOut(auth);
    showMessage("loginMessage", "此帳號沒有管理員權限");
    return;
  }

  $("loginView").classList.add("hidden");
  $("appView").classList.remove("hidden");
  $("currentAdmin").textContent = user.email || user.uid;
  if ($("currentAdminEmail")) {
  $("currentAdminEmail").value = user.email || "";
}

  await loadAll();
});

document.querySelectorAll(".nav").forEach(btn => btn.addEventListener("click", () => {
  document.querySelectorAll(".nav").forEach(x => x.classList.remove("active"));
  btn.classList.add("active");
  document.querySelectorAll(".page").forEach(x => x.classList.add("hidden"));
  $(btn.dataset.page).classList.remove("hidden");
  $("pageTitle").textContent = btn.textContent;
}));

async function readCollection(name) {
  const snap = await getDocs(collection(db, name));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function loadAll() {
  await Promise.all([loadDoctors(), loadPatients(), loadBindings(), loadAdmins()]);
  updateDashboard();
}

function updateDashboard() {
  $("doctorCount").textContent = state.doctors.length;
  $("pendingCount").textContent = state.doctors.filter(x => x.status === "pending").length;
  $("patientCount").textContent = state.patients.length;
  $("bindingCount").textContent = state.bindings.length;
}

async function loadDoctors() {
  state.doctors = await readCollection("doctors");
  renderDoctors();
  fillBindingSelects();
}

function renderDoctors() {
  const key = $("doctorSearch").value.trim().toLowerCase();

  const statusText = {
    pending: "待審核",
    approved: "已核准",
    rejected: "已拒絕"
  };

  const rows = state.doctors
    .filter(x =>
      `${nameOf(x)} ${x.email || ""}`
        .toLowerCase()
        .includes(key)
    )
    .map(x => {
      const status = x.status || "pending";

      let actionButtons = "";

      if (status === "pending") {
        actionButtons = `
          <button
            class="action approve"
            data-doctor-id="${x.id}"
            data-status="approved">
            核准
          </button>

          <button
            class="action reject"
            data-doctor-id="${x.id}"
            data-status="rejected">
            拒絕
          </button>
        `;
      } else if (status === "approved") {
        actionButtons = `
          <button
            class="action cancel-approve"
            data-doctor-id="${x.id}"
            data-status="pending">
            撤銷核准
          </button>
        `;
      } else if (status === "rejected") {
        actionButtons = `
          <button
            class="action approve"
            data-doctor-id="${x.id}"
            data-status="approved">
            重新核准
          </button>
        `;
      }

      return `
        <tr>
          <td>${escapeHtml(nameOf(x))}</td>
          <td>${escapeHtml(x.email)}</td>

          <td>
            <span class="status status-${status}">
              ${statusText[status] || status}
            </span>
          </td>

          <td class="doctor-actions">
            ${actionButtons}
          </td>
        </tr>
      `;
    })
    .join("");

  $("doctorTable").innerHTML =
    rows || `<tr><td colspan="4">沒有醫師資料</td></tr>`;

  document
    .querySelectorAll("[data-doctor-id]")
    .forEach(button => {
      button.addEventListener("click", async () => {
        const doctorId = button.dataset.doctorId;
        const newStatus = button.dataset.status;

        const confirmText = {
          approved: "確定要核准這位醫師嗎？",
          rejected: "確定要拒絕這位醫師嗎？",
          pending: "確定要撤銷這位醫師的核准狀態嗎？"
        };

        if (!confirm(confirmText[newStatus])) {
          return;
        }

        button.disabled = true;
        button.textContent = "處理中…";

        try {
          await setDoctorStatus(doctorId, newStatus);
        } catch (error) {
          console.error(error);
          alert("操作失敗：" + error.message);
          await loadDoctors();
        }
      });
    });
}

async function setDoctorStatus(id, status) {
  await updateDoc(doc(db, "doctors", id), { status, reviewedAt: serverTimestamp() });
  await loadDoctors(); updateDashboard();
}

async function loadPatients() {
  state.patients = await readCollection("users");
  renderPatients();
  fillBindingSelects();
}

function renderPatients() {
  const key = $("patientSearch").value.trim().toLowerCase();
  const rows = state.patients.filter(x =>
    `${nameOf(x)} ${x.email || ""}`.toLowerCase().includes(key)
  ).map(x => `
    <tr>
      <td>${escapeHtml(nameOf(x))}</td>
      <td>${escapeHtml(x.email)}</td>
      <td>${escapeHtml(x.diseaseType || x.disease || "")}</td>
      <td>${escapeHtml(x.nextVisit || "")}</td>
    </tr>`).join("");
  $("patientTable").innerHTML = rows || `<tr><td colspan="4">沒有資料</td></tr>`;
}

async function loadBindings() {
  state.bindings = await readCollection("bindings");
  const doctorMap = Object.fromEntries(state.doctors.map(x => [x.id, nameOf(x)]));
  const patientMap = Object.fromEntries(state.patients.map(x => [x.id, nameOf(x)]));
  $("bindingTable").innerHTML = state.bindings.map(x => `
    <tr>
      <td>${escapeHtml(doctorMap[x.doctorUid] || x.doctorUid)}</td>
      <td>${escapeHtml(patientMap[x.patientUid] || x.patientUid)}</td>
      <td>${escapeHtml(x.status || "accepted")}</td>
      <td><button class="action delete" data-delete-binding="${x.id}">解除</button></td>
    </tr>`).join("") || `<tr><td colspan="4">沒有資料</td></tr>`;
  document.querySelectorAll("[data-delete-binding]").forEach(b => b.onclick = async () => {
    if (!confirm("確定解除綁定？")) return;
    await deleteDoc(doc(db, "bindings", b.dataset.deleteBinding));
    await loadBindings(); updateDashboard();
  });
}

function fillBindingSelects() {
  $("bindingDoctor").innerHTML = `<option value="">選擇醫師</option>` +
    state.doctors.filter(x => x.status === "approved").map(x =>
      `<option value="${escapeHtml(x.id)}">${escapeHtml(nameOf(x))}</option>`).join("");
  $("bindingPatient").innerHTML = `<option value="">選擇病患</option>` +
    state.patients.map(x =>
      `<option value="${escapeHtml(x.id)}">${escapeHtml(nameOf(x))}</option>`).join("");
}

$("addBindingBtn").onclick = async () => {
  const doctorUid = $("bindingDoctor").value;
  const patientUid = $("bindingPatient").value;
  if (!doctorUid || !patientUid) return showMessage("bindingMessage", "請選擇醫師與病患");
  const id = `${doctorUid}_${patientUid}`;
  await setDoc(doc(db, "bindings", id), {
    doctorUid, patientUid, status: "accepted", createdAt: serverTimestamp()
  }, { merge: true });
  showMessage("bindingMessage", "綁定完成", true);
  await loadBindings(); updateDashboard();
};

async function loadAdmins() {
  state.admins = await readCollection("admins");
  $("adminTable").innerHTML = state.admins.map(x => `
    <tr>
      <td>${escapeHtml(x.name)}</td>
      <td>${escapeHtml(x.email)}</td>
      <td>${escapeHtml(x.id)}</td>
      <td>${x.id !== auth.currentUser?.uid ? `<button class="action delete" data-delete-admin="${x.id}">移除</button>` : "目前帳號"}</td>
    </tr>`).join("") || `<tr><td colspan="4">沒有資料</td></tr>`;
  document.querySelectorAll("[data-delete-admin]").forEach(b => b.onclick = async () => {
    if (!confirm("確定移除此管理員權限？")) return;
    await deleteDoc(doc(db, "admins", b.dataset.deleteAdmin));
    await loadAdmins();
  });
}

$("addAdminBtn").onclick = async () => {
  const email = $("adminEmail").value.trim();
  const password = $("adminPassword").value;
  const name = $("adminName").value.trim();

  if (!email || !password || !name) {
    return showMessage(
      "adminMessage",
      "姓名、Email、密碼都必須填寫"
    );
  }

  if (password.length < 6) {
    return showMessage(
      "adminMessage",
      "密碼至少需要 6 個字元"
    );
  }

  showMessage("adminMessage", "正在建立管理員……", true);
  $("addAdminBtn").disabled = true;

  try {
  const idToken = await auth.currentUser.getIdToken(true);

  const response = await fetch(
    "http://127.0.0.1:5501/create_admin",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${idToken}`
      },
      body: JSON.stringify({
        email,
        password,
        name
      })
    }
  );

    const result = await response.json();

    if (!response.ok || result.success !== true) {
      throw new Error(result.error || "新增管理員失敗");
    }

    showMessage(
      "adminMessage",
      "管理員帳號建立完成",
      true
    );

    $("adminEmail").value = "";
    $("adminPassword").value = "";
    $("adminName").value = "";

    await loadAdmins();
  } catch (error) {
    console.error(error);

    showMessage(
      "adminMessage",
      "新增失敗：" + error.message
    );
  } finally {
    $("addAdminBtn").disabled = false;
  }
};

$("doctorSearch").addEventListener("input", renderDoctors);
$("patientSearch").addEventListener("input", renderPatients);
$("reloadDoctors").onclick = loadDoctors;
$("reloadPatients").onclick = loadPatients;

$("updateCurrentAdminBtn").onclick = async () => {
  const email = $("currentAdminEmail").value.trim();
  const password = $("currentAdminPassword").value;
  const passwordConfirm =
    $("currentAdminPasswordConfirm").value;

  if (!email) {
    return showMessage(
      "currentAdminMessage",
      "Email 不可空白"
    );
  }

  if (password && password.length < 6) {
    return showMessage(
      "currentAdminMessage",
      "新密碼至少需要 6 個字元"
    );
  }

  if (password !== passwordConfirm) {
    return showMessage(
      "currentAdminMessage",
      "兩次輸入的新密碼不一致"
    );
  }

  const confirmed = confirm(
    "確定要修改目前帳戶的 Email 或密碼嗎？\n\n" +
    "修改成功後會自動登出，請使用新的帳戶資料重新登入。"
  );

  if (!confirmed) {
    return;
  }

  const button = $("updateCurrentAdminBtn");
  button.disabled = true;

  showMessage(
    "currentAdminMessage",
    "正在修改帳戶……",
    true
  );

  try {
    const idToken =
      await auth.currentUser.getIdToken(true);

    const response = await fetch(
      "http://127.0.0.1:5501/update_current_admin",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${idToken}`
        },
        body: JSON.stringify({
          email,
          password
        })
      }
    );

    const result = await response.json();

    if (!response.ok || result.success !== true) {
      throw new Error(
        result.error || "修改帳戶失敗"
      );
    }

    alert(
      "帳戶修改完成。\n" +
      "請使用新的 Email 和密碼重新登入。"
    );

    await signOut(auth);

    $("currentAdminPassword").value = "";
    $("currentAdminPasswordConfirm").value = "";

  } catch (error) {
    console.error(error);

    showMessage(
      "currentAdminMessage",
      "修改失敗：" + error.message
    );
  } finally {
    button.disabled = false;
  }
};

function closeAdminPanels() {

    $("editCurrentAdminPanel").classList.add("hidden");
    $("addAdminPanel").classList.add("hidden");

    $("showEditAdminBtn").classList.remove("active");
    $("showAddAdminBtn").classList.remove("active");

}


$("showEditAdminBtn").onclick = () => {

    const opened =
        !$("editCurrentAdminPanel")
            .classList.contains("hidden");

    closeAdminPanels();

    if (!opened) {

        $("editCurrentAdminPanel")
            .classList.remove("hidden");

        $("showEditAdminBtn")
            .classList.add("active");

    }

};


$("showAddAdminBtn").onclick = () => {

    const opened =
        !$("addAdminPanel")
            .classList.contains("hidden");

    closeAdminPanels();

    if (!opened) {

        $("addAdminPanel")
            .classList.remove("hidden");

        $("showAddAdminBtn")
            .classList.add("active");

    }

};