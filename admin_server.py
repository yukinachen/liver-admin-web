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

        # 建立 Firebase Authentication 帳號
        created_user = auth.create_user(
            email=email,
            password=password,
            display_name=name,
        )

        # 建立 Firestore 管理員文件
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
        # 若 Authentication 已建立，但 Firestore 建立失敗，
        # 刪除剛建立的帳號，避免留下不完整資料。
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