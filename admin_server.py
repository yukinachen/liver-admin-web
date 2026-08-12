import os

from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
import firebase_admin
from firebase_admin import credentials, auth, firestore


# 初始化 Firebase Admin
credential_path = os.environ.get(
    "GOOGLE_APPLICATION_CREDENTIALS",
    "serviceAccountKey.json",
)

if not firebase_admin._apps:
    cred = credentials.Certificate(credential_path)
    firebase_admin.initialize_app(cred)

db = firestore.client()

app = Flask(
    __name__,
    static_folder=".",
    static_url_path=""
)
CORS(app)


def get_current_admin_uid():
    """
    驗證前端傳來的 Firebase ID Token，
    並確認該使用者存在於 admins 集合且未被停用。
    """
    authorization = request.headers.get("Authorization", "")

    if not authorization.startswith("Bearer "):
        raise ValueError("缺少登入驗證資訊")

    id_token = authorization[7:].strip()

    if not id_token:
        raise ValueError("登入驗證資訊無效")

    decoded_token = auth.verify_id_token(id_token)
    uid = decoded_token["uid"]

    admin_ref = db.collection("admins").document(uid)
    admin_doc = admin_ref.get()

    if not admin_doc.exists:
        raise PermissionError("此帳號沒有管理員權限")

    admin_data = admin_doc.to_dict() or {}

    if admin_data.get("disabled") is True:
        raise PermissionError("此管理員帳號已停用")

    return uid


@app.route("/create_admin", methods=["POST"])
def create_admin():
    created_user = None

    try:
        # 只有已登入且有效的管理員才能新增管理員
        creator_uid = get_current_admin_uid()

        data = request.get_json(silent=True) or {}

        email = str(data.get("email", "")).strip()
        password = str(data.get("password", ""))
        name = str(data.get("name", "")).strip()

        if not email or not password or not name:
            raise ValueError("姓名、Email、密碼都必須填寫")

        if len(password) < 6:
            raise ValueError("密碼至少需要 6 個字元")

        # -------------------------------------------------
        # 先直接用 Email 檢查 Firestore 角色。
        # 不依賴 document ID 是否剛好等於 Firebase Auth UID。
        # -------------------------------------------------
        doctor_matches = list(
            db.collection("doctors")
            .where("email", "==", email)
            .limit(1)
            .stream()
        )

        if doctor_matches:
            doctor_data = doctor_matches[0].to_dict() or {}

            if doctor_data.get("role") == "case_manager":
                raise ValueError("此 Email 已註冊為個管師，不能建立為管理員")

            raise ValueError("此 Email 已註冊為醫師，不能建立為管理員")

        patient_matches = list(
            db.collection("users")
            .where("email", "==", email)
            .limit(1)
            .stream()
        )

        if patient_matches:
            raise ValueError("此 Email 已註冊為病患，不能建立為管理員")

        admin_matches = list(
            db.collection("admins")
            .where("email", "==", email)
            .limit(1)
            .stream()
        )

        if admin_matches:
            raise ValueError("此 Email 已經是管理員帳號")

        # Firestore 沒找到角色後，再檢查 Firebase Authentication。
        # 只要 Authentication 中已經存在同 Email，也不允許建立，
        # 避免既有帳號被重複建立或誤升級成管理員。
        try:
            auth.get_user_by_email(email)
            raise ValueError("此 Email 已存在 Firebase 帳號，不能建立為管理員")
        except auth.UserNotFoundError:
            pass

        # 只有完全沒有註冊過的新 Email 才建立管理員
        created_user = auth.create_user(
            email=email,
            password=password,
            display_name=name,
        )

        db.collection("admins").document(created_user.uid).set({
            "email": email,
            "name": name,
            "disabled": False,
            "createdBy": creator_uid,
            "createdAt": firestore.SERVER_TIMESTAMP,
        })

        return jsonify({
            "success": True,
            "uid": created_user.uid,
            "message": "管理員帳號建立完成",
        })

    except PermissionError as error:
        return jsonify({
            "success": False,
            "error": str(error),
        }), 403

    except Exception as error:
        # 只有本次新建立、且後續 Firestore 寫入失敗時才刪除
        if created_user is not None:
            try:
                auth.delete_user(created_user.uid)
            except Exception:
                pass

        return jsonify({
            "success": False,
            "error": str(error),
        }), 400


@app.route("/update_current_admin", methods=["POST"])
def update_current_admin():
    try:
        uid = get_current_admin_uid()

        data = request.get_json(silent=True) or {}

        new_email = str(data.get("email", "")).strip()
        new_password = str(data.get("password", ""))

        if not new_email:
            raise ValueError("Email 不可空白")

        # 密碼留空表示不修改密碼
        if new_password and len(new_password) < 6:
            raise ValueError("新密碼至少需要 6 個字元")

        update_fields = {
            "email": new_email,
        }

        if new_password:
            update_fields["password"] = new_password

        # 更新 Firebase Authentication
        updated_user = auth.update_user(
            uid,
            **update_fields,
        )

        # 同步更新 Firestore
        db.collection("admins").document(uid).update({
            "email": updated_user.email,
            "updatedAt": firestore.SERVER_TIMESTAMP,
        })

        return jsonify({
            "success": True,
            "email": updated_user.email,
            "message": "帳戶資料修改完成",
        })

    except PermissionError as error:
        return jsonify({
            "success": False,
            "error": str(error),
        }), 403

    except Exception as error:
        return jsonify({
            "success": False,
            "error": str(error),
        }), 400

@app.route("/")
def home():
    return send_from_directory(".", "index.html")

@app.route("/health", methods=["GET"])
def health():
    return jsonify({
        "success": True,
        "message": "Admin server is running",
    })
    
@app.route("/css/<path:filename>")
def css(filename):
    return send_from_directory("css", filename)


@app.route("/js/<path:filename>")
def js(filename):
    return send_from_directory("js", filename)

if __name__ == "__main__":
    port = int(os.environ.get("PORT", "5501"))

    app.run(
        host="0.0.0.0",
        port=port,
        debug=False,
    )