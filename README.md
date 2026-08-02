# 肝臟健康管理員網頁（簡易電腦版）

## 功能
- 管理員 Email/密碼登入
- 醫師審核
- 病患清單
- 醫師與病患綁定
- 管理員權限管理
- 首頁簡單統計

## 1. 填入 Firebase 設定
打開 `js/firebase-config.js`，將 Firebase Console 的 Web App 設定貼進去。

Firebase Console 路徑：
`專案設定 → 您的應用程式 → Web App → SDK 設定與配置`

## 2. 建立第一個管理員
因為一開始資料庫還沒有管理員，請先做以下兩件事：

1. Firebase Authentication → Users → Add user  
   建立 Email/密碼帳號並複製 UID。

2. Firestore Database → 建立集合 `admins`  
   文件 ID 使用剛才的 UID，欄位如下：

- `email`：string
- `name`：string
- `active`：boolean，值為 `true`

## 3. Firestore 集合
網站預設使用：

- `admins/{uid}`
- `doctors/{doctorUid}`
- `users/{patientUid}`
- `bindings/{doctorUid_patientUid}`

醫師欄位可使用：
- `name`
- `email`
- `status`：`pending`、`approved`、`rejected`

病患欄位可使用：
- `name`
- `email`
- `diseaseType`
- `nextVisit`

綁定欄位：
- `doctorUid`
- `patientUid`
- `status`

## 4. 套用安全規則
`firestore.rules` 是管理員網頁所需的最小規則範例。

若你的手機 App 已經有正式規則，請不要直接覆蓋整份；將其中 `isAdmin()` 與管理員權限合併進原規則。

## 5. 執行
不能直接雙擊 HTML，請用本機伺服器。

有 Python 時，在此資料夾開 PowerShell：

```powershell
python -m http.server 5500
```

瀏覽器開啟：

```text
http://127.0.0.1:5500
```

## 注意
「管理員管理」頁面只會新增或移除 Firestore 的管理員權限，不會自動建立 Firebase Authentication 帳號。
新管理員需先在 Firebase Authentication 建立登入帳號，再把 UID 登記到 `admins`。
