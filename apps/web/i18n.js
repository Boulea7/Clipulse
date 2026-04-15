export const DEFAULT_LOCALE = 'en'
export const LOCALE_COOKIE_NAME = 'clipulse_dashboard_locale'
const LEGACY_LOCALE_COOKIE_NAMES = ['clipulse_locale']

const SUPPORTED_LOCALES = [
  'en',
  'zh-CN',
  'zh-TW',
  'es',
  'pt-BR',
  'ja',
  'ko',
  'de',
  'fr',
  'ru',
  'hi',
  'id',
  'tr',
  'it',
  'nl',
]

const LOCALE_OPTIONS = [
  { value: 'en', label: 'English' },
  { value: 'zh-CN', label: '简体中文' },
  { value: 'zh-TW', label: '繁體中文' },
  { value: 'es', label: 'Español' },
  { value: 'pt-BR', label: 'Português (Brasil)' },
  { value: 'ja', label: '日本語' },
  { value: 'ko', label: '한국어' },
  { value: 'de', label: 'Deutsch' },
  { value: 'fr', label: 'Français' },
  { value: 'ru', label: 'Русский' },
  { value: 'hi', label: 'हिन्दी' },
  { value: 'id', label: 'Bahasa Indonesia' },
  { value: 'tr', label: 'Türkçe' },
  { value: 'it', label: 'Italiano' },
  { value: 'nl', label: 'Nederlands' },
]

export const DASHBOARD_LOGIN_TRANSLATIONS_JSON = `{
  "en": {
    "title": "Clipulse Dashboard Login",
    "heading": "Protected Clipulse dashboard",
    "message": "Clipulse dashboard access token is required.",
    "help": "Enter the dashboard access token for this Clipulse deployment.",
    "token_label": "Dashboard access token",
    "submit": "Open dashboard",
    "invalid_token": "Invalid token. Check the dashboard access token and try again.",
    "failed": "Dashboard login failed. Check the proxy and server logs, then retry.",
    "network_failed": "Could not reach the Clipulse server. Check the network path and retry.",
    "language": "Language",
    "invalid_token_api_message": "dashboard access token is invalid",
    "invalid_token_api_hint": "Provide the configured Clipulse dashboard access token and try again."
  },
  "zh-CN": {
    "title": "Clipulse Dashboard 登录",
    "heading": "受保护的 Clipulse dashboard",
    "message": "需要 Clipulse dashboard 访问 token。",
    "help": "请输入这个 Clipulse 部署的 dashboard 访问 token。",
    "token_label": "Dashboard 访问 token",
    "submit": "打开 dashboard",
    "invalid_token": "Token 无效，请检查 dashboard 访问 token 后重试。",
    "failed": "Dashboard 登录失败，请检查代理和服务端日志后再试。",
    "network_failed": "无法连到 Clipulse 服务，请检查网络路径后重试。",
    "language": "语言",
    "invalid_token_api_message": "dashboard 访问 token 无效",
    "invalid_token_api_hint": "请提供已配置的 Clipulse dashboard 访问 token 后重试。"
  },
  "zh-TW": {
    "title": "Clipulse Dashboard 登入",
    "heading": "受保護的 Clipulse dashboard",
    "message": "需要 Clipulse dashboard 存取 token。",
    "help": "請輸入這個 Clipulse 部署的 dashboard 存取 token。",
    "token_label": "Dashboard 存取 token",
    "submit": "打開 dashboard",
    "invalid_token": "Token 無效，請檢查 dashboard 存取 token 後再試一次。",
    "failed": "Dashboard 登入失敗，請檢查代理與伺服器日誌後再試一次。",
    "network_failed": "無法連上 Clipulse 伺服器，請檢查網路路徑後再試一次。",
    "language": "語言",
    "invalid_token_api_message": "dashboard 存取 token 無效",
    "invalid_token_api_hint": "請提供已設定的 Clipulse dashboard 存取 token 後再試一次。"
  },
  "es": {
    "title": "Inicio de sesión de Clipulse Dashboard",
    "heading": "Dashboard protegido de Clipulse",
    "message": "Se requiere el token de acceso del dashboard de Clipulse.",
    "help": "Introduce el token de acceso del dashboard para esta instalación de Clipulse.",
    "token_label": "Token de acceso del dashboard",
    "submit": "Abrir dashboard",
    "invalid_token": "El token no es válido. Verifica el token de acceso del dashboard y vuelve a intentarlo.",
    "failed": "No se pudo iniciar sesión en el dashboard. Revisa el proxy y los logs del servidor, y vuelve a intentarlo.",
    "network_failed": "No se pudo conectar con el servidor de Clipulse. Revisa la ruta de red y vuelve a intentarlo.",
    "language": "Idioma",
    "invalid_token_api_message": "el token de acceso del dashboard no es válido",
    "invalid_token_api_hint": "Proporciona el token de acceso configurado para el dashboard de Clipulse y vuelve a intentarlo."
  },
  "pt-BR": {
    "title": "Login do Clipulse Dashboard",
    "heading": "Dashboard protegido do Clipulse",
    "message": "O token de acesso do dashboard do Clipulse é obrigatório.",
    "help": "Digite o token de acesso do dashboard para esta instalação do Clipulse.",
    "token_label": "Token de acesso do dashboard",
    "submit": "Abrir dashboard",
    "invalid_token": "O token é inválido. Verifique o token de acesso do dashboard e tente novamente.",
    "failed": "Falha no login do dashboard. Verifique o proxy e os logs do servidor e tente novamente.",
    "network_failed": "Não foi possível alcançar o servidor do Clipulse. Verifique o caminho de rede e tente novamente.",
    "language": "Idioma",
    "invalid_token_api_message": "o token de acesso do dashboard é inválido",
    "invalid_token_api_hint": "Informe o token de acesso configurado para o dashboard do Clipulse e tente novamente."
  },
  "ja": {
    "title": "Clipulse ダッシュボードへログイン",
    "heading": "保護された Clipulse ダッシュボード",
    "message": "Clipulse ダッシュボードのアクセストークンが必要です。",
    "help": "この Clipulse デプロイ用のダッシュボードアクセストークンを入力してください。",
    "token_label": "ダッシュボードアクセストークン",
    "submit": "ダッシュボードを開く",
    "invalid_token": "トークンが無効です。ダッシュボードアクセストークンを確認して再試行してください。",
    "failed": "ダッシュボードへのログインに失敗しました。プロキシとサーバーログを確認して再試行してください。",
    "network_failed": "Clipulse サーバーに接続できませんでした。ネットワーク経路を確認して再試行してください。",
    "language": "言語",
    "invalid_token_api_message": "ダッシュボードアクセストークンが無効です",
    "invalid_token_api_hint": "設定済みの Clipulse ダッシュボードアクセストークンを入力して再試行してください。"
  },
  "ko": {
    "title": "Clipulse 대시보드 로그인",
    "heading": "보호된 Clipulse 대시보드",
    "message": "Clipulse 대시보드 액세스 토큰이 필요합니다.",
    "help": "이 Clipulse 배포의 대시보드 액세스 토큰을 입력하세요.",
    "token_label": "대시보드 액세스 토큰",
    "submit": "대시보드 열기",
    "invalid_token": "잘못된 토큰입니다. 대시보드 액세스 토큰을 확인한 뒤 다시 시도하세요.",
    "failed": "대시보드 로그인에 실패했습니다. 프록시와 서버 로그를 확인한 뒤 다시 시도하세요.",
    "network_failed": "Clipulse 서버에 연결할 수 없습니다. 네트워크 경로를 확인한 뒤 다시 시도하세요.",
    "language": "언어",
    "invalid_token_api_message": "대시보드 액세스 토큰이 올바르지 않습니다",
    "invalid_token_api_hint": "설정된 Clipulse 대시보드 액세스 토큰을 입력한 뒤 다시 시도하세요."
  },
  "de": {
    "title": "Clipulse-Dashboard-Anmeldung",
    "heading": "Geschütztes Clipulse-Dashboard",
    "message": "Das Zugriffstoken für das Clipulse-Dashboard ist erforderlich.",
    "help": "Gib das Zugriffstoken für dieses Clipulse-Deployment ein.",
    "token_label": "Dashboard-Zugriffstoken",
    "submit": "Dashboard öffnen",
    "invalid_token": "Das Token ist ungültig. Prüfe das Dashboard-Zugriffstoken und versuche es erneut.",
    "failed": "Die Dashboard-Anmeldung ist fehlgeschlagen. Prüfe den Proxy und die Server-Logs und versuche es erneut.",
    "network_failed": "Der Clipulse-Server konnte nicht erreicht werden. Prüfe den Netzwerkpfad und versuche es erneut.",
    "language": "Sprache",
    "invalid_token_api_message": "das Dashboard-Zugriffstoken ist ungültig",
    "invalid_token_api_hint": "Sende das konfigurierte Zugriffstoken für das Clipulse-Dashboard und versuche es erneut."
  },
  "fr": {
    "title": "Connexion au dashboard Clipulse",
    "heading": "Dashboard Clipulse protégé",
    "message": "Le jeton d'accès au dashboard Clipulse est requis.",
    "help": "Saisissez le jeton d'accès au dashboard pour cette installation Clipulse.",
    "token_label": "Jeton d'accès au dashboard",
    "submit": "Ouvrir le dashboard",
    "invalid_token": "Le jeton est invalide. Vérifiez le jeton d'accès au dashboard et réessayez.",
    "failed": "La connexion au dashboard a échoué. Vérifiez le proxy et les logs du serveur, puis réessayez.",
    "network_failed": "Impossible de joindre le serveur Clipulse. Vérifiez le chemin réseau, puis réessayez.",
    "language": "Langue",
    "invalid_token_api_message": "le jeton d'accès au dashboard est invalide",
    "invalid_token_api_hint": "Fournissez le jeton d'accès configuré pour le dashboard Clipulse, puis réessayez."
  },
  "ru": {
    "title": "Вход в dashboard Clipulse",
    "heading": "Защищённый dashboard Clipulse",
    "message": "Требуется токен доступа к dashboard Clipulse.",
    "help": "Введите токен доступа к dashboard для этого развёртывания Clipulse.",
    "token_label": "Токен доступа к dashboard",
    "submit": "Открыть dashboard",
    "invalid_token": "Токен недействителен. Проверьте токен доступа к dashboard и попробуйте снова.",
    "failed": "Не удалось войти в dashboard. Проверьте прокси и журналы сервера, затем попробуйте снова.",
    "network_failed": "Не удалось связаться с сервером Clipulse. Проверьте сетевой маршрут и попробуйте снова.",
    "language": "Язык",
    "invalid_token_api_message": "токен доступа к dashboard недействителен",
    "invalid_token_api_hint": "Передайте настроенный токен доступа к dashboard Clipulse и попробуйте снова."
  },
  "hi": {
    "title": "Clipulse डैशबोर्ड लॉगिन",
    "heading": "सुरक्षित Clipulse डैशबोर्ड",
    "message": "Clipulse डैशबोर्ड एक्सेस टोकन आवश्यक है।",
    "help": "इस Clipulse डिप्लॉयमेंट के लिए डैशबोर्ड एक्सेस टोकन दर्ज करें।",
    "token_label": "डैशबोर्ड एक्सेस टोकन",
    "submit": "डैशबोर्ड खोलें",
    "invalid_token": "टोकन अमान्य है। डैशबोर्ड एक्सेस टोकन जांचें और फिर से कोशिश करें।",
    "failed": "डैशबोर्ड लॉगिन विफल रहा। प्रॉक्सी और सर्वर लॉग जांचें, फिर दोबारा कोशिश करें।",
    "network_failed": "Clipulse सर्वर तक पहुंचा नहीं जा सका। नेटवर्क पथ जांचें और फिर से कोशिश करें।",
    "language": "भाषा",
    "invalid_token_api_message": "डैशबोर्ड एक्सेस टोकन अमान्य है",
    "invalid_token_api_hint": "कॉन्फ़िगर किया गया Clipulse डैशबोर्ड एक्सेस टोकन भेजें और फिर से कोशिश करें।"
  },
  "id": {
    "title": "Masuk ke Dashboard Clipulse",
    "heading": "Dashboard Clipulse terlindungi",
    "message": "Token akses dashboard Clipulse diperlukan.",
    "help": "Masukkan token akses dashboard untuk deployment Clipulse ini.",
    "token_label": "Token akses dashboard",
    "submit": "Buka dashboard",
    "invalid_token": "Token tidak valid. Periksa token akses dashboard lalu coba lagi.",
    "failed": "Login dashboard gagal. Periksa proxy dan log server lalu coba lagi.",
    "network_failed": "Tidak dapat menjangkau server Clipulse. Periksa jalur jaringan lalu coba lagi.",
    "language": "Bahasa",
    "invalid_token_api_message": "token akses dashboard tidak valid",
    "invalid_token_api_hint": "Kirim token akses dashboard Clipulse yang sudah dikonfigurasi lalu coba lagi."
  },
  "tr": {
    "title": "Clipulse Dashboard Girişi",
    "heading": "Korumalı Clipulse dashboard",
    "message": "Clipulse dashboard erişim belirteci gereklidir.",
    "help": "Bu Clipulse kurulumu için dashboard erişim belirtecini girin.",
    "token_label": "Dashboard erişim belirteci",
    "submit": "Dashboard’u aç",
    "invalid_token": "Belirteç geçersiz. Dashboard erişim belirtecini kontrol edip yeniden deneyin.",
    "failed": "Dashboard oturumu açılamadı. Proxy'yi ve sunucu günlüklerini kontrol edip yeniden deneyin.",
    "network_failed": "Clipulse sunucusuna ulaşılamadı. Ağ yolunu kontrol edip yeniden deneyin.",
    "language": "Dil",
    "invalid_token_api_message": "dashboard erişim belirteci geçersiz",
    "invalid_token_api_hint": "Yapılandırılmış Clipulse dashboard erişim belirtecini gönderip yeniden deneyin."
  },
  "it": {
    "title": "Accesso al dashboard Clipulse",
    "heading": "Dashboard Clipulse protetto",
    "message": "È richiesto il token di accesso al dashboard Clipulse.",
    "help": "Inserisci il token di accesso al dashboard per questa installazione di Clipulse.",
    "token_label": "Token di accesso al dashboard",
    "submit": "Apri dashboard",
    "invalid_token": "Il token non è valido. Controlla il token di accesso al dashboard e riprova.",
    "failed": "Accesso al dashboard non riuscito. Controlla il proxy e i log del server, poi riprova.",
    "network_failed": "Impossibile raggiungere il server Clipulse. Controlla il percorso di rete e riprova.",
    "language": "Lingua",
    "invalid_token_api_message": "il token di accesso al dashboard non è valido",
    "invalid_token_api_hint": "Fornisci il token di accesso configurato per il dashboard Clipulse e riprova."
  },
  "nl": {
    "title": "Clipulse-dashboard aanmelden",
    "heading": "Beveiligd Clipulse-dashboard",
    "message": "Het Clipulse-dashboardtoegangstoken is vereist.",
    "help": "Voer het dashboardtoegangstoken voor deze Clipulse-deployment in.",
    "token_label": "Dashboardtoegangstoken",
    "submit": "Dashboard openen",
    "invalid_token": "Het token is ongeldig. Controleer het dashboardtoegangstoken en probeer het opnieuw.",
    "failed": "Aanmelden bij het dashboard is mislukt. Controleer de proxy en de serverlogs en probeer het opnieuw.",
    "network_failed": "De Clipulse-server kon niet worden bereikt. Controleer het netwerkpad en probeer het opnieuw.",
    "language": "Taal",
    "invalid_token_api_message": "het dashboardtoegangstoken is ongeldig",
    "invalid_token_api_hint": "Geef het geconfigureerde Clipulse-dashboardtoegangstoken door en probeer het opnieuw."
  }
}`

const DASHBOARD_LOGIN_TRANSLATIONS = JSON.parse(DASHBOARD_LOGIN_TRANSLATIONS_JSON)

const LOGIN_COPY_TO_MESSAGE_KEYS = {
  title: 'login.title',
  heading: 'login.heading',
  message: 'login.message',
  help: 'login.help',
  token_label: 'login.tokenLabel',
  submit: 'login.submit',
  invalid_token: 'login.invalidToken',
  failed: 'login.failed',
  network_failed: 'login.networkFailed',
  language: 'locale.label',
}

const EN_MESSAGES = {
  'shell.heroTitle': 'Self-hosted activity tracking for coding-agent CLIs.',
  'shell.heroDescription': 'Track active time, waiting time, AI-generated line changes, and language usage across tools like Claude Code and Codex.',
  'shell.panelEyebrow': 'Alpha Dashboard',
  'shell.viewDescription.home': 'Clipulse keeps this dashboard local-first, compact, and readable for daily checks. Metrics are summary-first heuristics meant for quick inspection.',
  'shell.viewDescription.project': 'Inspect project-level rollups and recent sessions from the latest snapshot.',
  'shell.viewDescription.session': 'Inspect one logical session and its surrounding snapshot context.',
  'nav.home': 'Home',
  'nav.project': 'Project',
  'nav.session': 'Session',
  'locale.label': 'Language',
  'button.logout': 'Log out',
  'button.loggingOut': 'Logging out...',
  'button.returnToSignIn': 'Return to sign-in',
  'button.switchAccount': 'Log out and switch account',
  'auth.active': 'Protected dashboard session active.',
  'auth.signInRequired': 'Sign in required for this protected dashboard. Sign in again, then reload.',
  'auth.accessBlocked': 'Access blocked for the current account. Log out to switch accounts.',
  'auth.unavailable': 'Dashboard auth status is unavailable. Check API/dashboard version compatibility.',
  'auth.signedOut': 'Logged out. Sign in again to reopen the protected dashboard.',
  'auth.logoutFailed': 'Logout failed. Try again.',
  'auth.signingOut': 'Signing out of the protected dashboard...',
  'section.overview': 'Overview',
  'section.languages': 'Languages',
  'section.models': 'Models',
  'section.hosts': 'Hosts',
  'section.projects': 'Projects',
  'section.recentSessions': 'Recent Sessions',
  'section.projectSessions': 'Project Sessions',
  'section.relatedSessions': 'Related Sessions',
  'section.relatedSessionsFallback': 'Related Sessions (recent feed fallback)',
  'section.dailyActivity': 'Daily Activity',
  'section.details': 'Details',
  'label.status': 'Status',
  'label.hint': 'Hint',
  'label.project': 'Project',
  'label.projectRef': 'Project ref',
  'label.activeTime': 'Active time',
  'label.waitTime': 'Wait time',
  'label.events': 'Events',
  'label.routeSummary': 'Route summary',
  'label.sessions': 'Sessions',
  'label.changedFiles': 'Changed files',
  'label.languages': 'Languages',
  'label.lineChanges': 'Line changes',
  'label.primaryHostModel': 'Primary host-model',
  'label.hostMaturity': 'Host maturity',
  'label.hostModelMix': 'Host-model mix',
  'label.coverageNote': 'Coverage note',
  'label.fileIdentifiers': 'File identifiers',
  'label.lastEventType': 'Last event type',
  'label.lastEvent': 'Last event',
  'label.projectSessions': 'Project sessions',
  'label.compatibility': 'Compatibility',
  'label.compatibilityMode': 'Compatibility mode',
  'label.compatibilitySource': 'Compatibility source',
  'label.compatibilityScope': 'Compatibility scope',
  'label.fallbackSections': 'Fallback sections',
  'label.affectedFields': 'Affected fields',
  'label.contractMeta': 'Contract meta',
  'label.dashboardCompatibility': 'Dashboard compatibility',
  'label.queueStatus': 'Queue status',
  'label.statusMetadata': 'Status metadata',
  'label.dataCompleteness': 'Data completeness',
  'label.relatedFeed': 'Related feed',
  'label.state': 'State',
  'label.firstEvent': 'First event',
  'label.lastHost': 'Last host',
  'label.observedHost': 'Observed host',
  'label.lastModel': 'Last model',
  'label.observedModel': 'Observed model',
  'label.lastBranch': 'Last branch',
  'label.observedBranch': 'Observed branch',
  'label.runtimeProfile': 'Runtime profile',
  'label.operatorSummary': 'Operator summary',
  'label.queueNote': 'Queue note',
  'message.loading': 'Loading...',
  'message.loadingOverview': 'Loading overview...',
  'message.loadingLanguageData': 'Loading language data...',
  'message.loadingModelData': 'Loading model data...',
  'message.loadingHostData': 'Loading host data...',
  'message.loadingProjectData': 'Loading project data...',
  'message.loadingRecentSessions': 'Loading recent sessions...',
  'message.loadingProjectSessions': 'Loading project sessions...',
  'message.loadingRelatedSessions': 'Loading related sessions...',
  'message.loadingDailyActivity': 'Loading daily activity...',
  'message.signInReloadPrivate': 'Sign in again to reload private dashboard data.',
  'message.signInReloadLanguage': 'Sign in again to reload language data.',
  'message.signInReloadModel': 'Sign in again to reload model data.',
  'message.signInReloadHost': 'Sign in again to reload host data.',
  'message.signInLoadProject': 'Sign in again to load project data.',
  'message.signInLoadRecentSessions': 'Sign in again to load recent sessions.',
  'message.signInReloadDaily': 'Sign in again to reload daily activity.',
  'message.dashboardSignedOut': 'Dashboard signed out',
  'message.signedOutDescription': 'Private dashboard data was cleared from this page after logout.',
  'message.signedOutSuccess': 'Signed out successfully.',
  'message.signedOutHint': 'Sign in again to load private dashboard data.',
  'message.noDailyActivityYet': 'No daily activity yet.',
  'message.notRecordedYet': 'Not recorded yet',
  'metric.totalEvents': 'Total events',
  'metric.totalActive': 'Total active',
  'metric.totalWait': 'Total wait',
  'metric.todayActive': 'Today active',
  'metric.thisWeekActive': 'This week active',
  'login.title': 'Clipulse Dashboard Login',
  'login.heading': 'Protected Clipulse dashboard',
  'login.message': 'Clipulse dashboard access token is required.',
  'login.help': 'Enter the dashboard access token for this Clipulse deployment.',
  'login.tokenLabel': 'Dashboard access token',
  'login.submit': 'Open dashboard',
  'login.invalidToken': 'Invalid token. Check the dashboard access token and try again.',
  'login.failed': 'Dashboard login failed. Check the proxy and server logs, then retry.',
  'login.networkFailed': 'Could not reach the Clipulse server. Check the network path and retry.',
  'unit.day.one': 'day',
  'unit.day.other': 'days',
  'unit.hr.one': 'hr',
  'unit.hr.other': 'hr',
  'unit.min.one': 'min',
  'unit.min.other': 'min',
  'unit.sec.one': 'sec',
  'unit.sec.other': 'sec',
}

const LOCALE_MESSAGES = {
  'zh-CN': {
    'nav.home': '首页',
    'nav.project': '项目',
    'nav.session': '会话',
    'locale.label': '语言',
    'button.logout': '退出登录',
    'button.loggingOut': '正在退出...',
    'button.returnToSignIn': '返回登录页',
    'button.switchAccount': '退出并切换账号',
    'auth.active': '受保护 dashboard 会话已激活。',
    'auth.signInRequired': '这个受保护 dashboard 需要重新登录后再刷新。',
    'auth.accessBlocked': '当前账号被拒绝访问。请退出后切换账号。',
    'auth.unavailable': '暂时无法确认 dashboard 鉴权状态，请检查 API 与 dashboard 版本兼容性。',
    'auth.signedOut': '已退出登录。重新登录即可再次打开受保护 dashboard。',
    'auth.logoutFailed': '退出失败，请重试。',
    'auth.signingOut': '正在退出受保护 dashboard...',
    'section.overview': '概览',
    'section.languages': '语言',
    'section.models': '模型',
    'section.hosts': 'Host',
    'section.projects': '项目',
    'section.recentSessions': '最近会话',
    'section.projectSessions': '项目会话',
    'section.relatedSessions': '关联会话',
    'section.relatedSessionsFallback': '关联会话（recent feed 回退）',
    'section.dailyActivity': '每日活动',
    'section.details': '详情',
    'login.title': 'Clipulse Dashboard 登录',
    'login.heading': '受保护的 Clipulse dashboard',
    'login.message': '需要 Clipulse dashboard 访问 token。',
    'login.help': '请输入这个 Clipulse 部署的 dashboard 访问 token。',
    'login.tokenLabel': 'Dashboard 访问 token',
    'login.submit': '打开 dashboard',
    'login.invalidToken': 'Token 无效，请检查 dashboard 访问 token 后重试。',
    'login.failed': 'Dashboard 登录失败，请检查代理和服务端日志后再试。',
    'login.networkFailed': '无法连到 Clipulse 服务，请检查网络路径后重试。',
    'message.signInReloadPrivate': '请重新登录以加载私有 dashboard 数据。',
    'message.signInLoadRecentSessions': '请重新登录以加载最近会话。',
    'message.loadingOverview': '正在加载概览...',
    'message.loadingDailyActivity': '正在加载每日活动...',
    'message.noDailyActivityYet': '还没有每日活动数据。',
    'unit.day.one': '天',
    'unit.day.other': '天',
    'unit.hr.one': '小时',
    'unit.hr.other': '小时',
    'unit.min.one': '分',
    'unit.min.other': '分',
    'unit.sec.one': '秒',
    'unit.sec.other': '秒',
  },
  'zh-TW': {
    'nav.home': '首頁',
    'nav.project': '專案',
    'nav.session': '工作階段',
    'locale.label': '語言',
    'button.logout': '登出',
    'button.loggingOut': '正在登出...',
    'button.returnToSignIn': '返回登入頁',
    'button.switchAccount': '登出並切換帳號',
    'auth.active': '受保護 dashboard 工作階段已啟用。',
    'login.title': 'Clipulse Dashboard 登入',
    'login.heading': '受保護的 Clipulse dashboard',
    'login.message': '需要 Clipulse dashboard 存取 token。',
    'login.help': '請輸入這個 Clipulse 部署的 dashboard 存取 token。',
    'login.tokenLabel': 'Dashboard 存取 token',
    'login.submit': '打開 dashboard',
    'unit.day.one': '天',
    'unit.day.other': '天',
    'unit.hr.one': '小時',
    'unit.hr.other': '小時',
    'unit.min.one': '分',
    'unit.min.other': '分',
    'unit.sec.one': '秒',
    'unit.sec.other': '秒',
  },
  es: {
    'nav.home': 'Inicio',
    'nav.project': 'Proyecto',
    'nav.session': 'Sesión',
    'locale.label': 'Idioma',
    'button.logout': 'Cerrar sesión',
    'button.loggingOut': 'Cerrando sesión...',
    'button.returnToSignIn': 'Volver al acceso',
    'button.switchAccount': 'Cerrar sesión y cambiar cuenta',
    'login.title': 'Inicio de sesión de Clipulse Dashboard',
    'login.heading': 'Dashboard protegido de Clipulse',
    'login.message': 'Se requiere el token de acceso del dashboard de Clipulse.',
    'login.help': 'Introduce el token de acceso del dashboard para esta instalación de Clipulse.',
    'login.tokenLabel': 'Token de acceso del dashboard',
    'login.submit': 'Abrir dashboard',
  },
  'pt-BR': {
    'nav.home': 'Início',
    'nav.project': 'Projeto',
    'nav.session': 'Sessão',
    'locale.label': 'Idioma',
    'button.logout': 'Sair',
    'button.loggingOut': 'Saindo...',
    'button.returnToSignIn': 'Voltar ao login',
    'button.switchAccount': 'Sair e trocar de conta',
    'login.title': 'Login do Clipulse Dashboard',
    'login.heading': 'Dashboard protegido do Clipulse',
    'login.message': 'O token de acesso do dashboard do Clipulse é obrigatório.',
    'login.help': 'Digite o token de acesso do dashboard para esta instalação do Clipulse.',
    'login.tokenLabel': 'Token de acesso do dashboard',
    'login.submit': 'Abrir dashboard',
  },
  ja: {
    'nav.home': 'ホーム',
    'nav.project': 'プロジェクト',
    'nav.session': 'セッション',
    'locale.label': '言語',
    'button.logout': 'ログアウト',
    'button.loggingOut': 'ログアウト中...',
    'button.returnToSignIn': 'サインインへ戻る',
    'button.switchAccount': 'ログアウトしてアカウントを切り替える',
    'auth.active': '保護された dashboard セッションが有効です。',
    'section.overview': '概要',
    'section.languages': '言語',
    'section.models': 'モデル',
    'section.hosts': 'ホスト',
    'section.projects': 'プロジェクト',
    'section.recentSessions': '最近のセッション',
    'section.projectSessions': 'プロジェクトのセッション',
    'section.relatedSessions': '関連セッション',
    'section.relatedSessionsFallback': '関連セッション（recent feed フォールバック）',
    'section.dailyActivity': '日次アクティビティ',
    'section.details': '詳細',
    'login.title': 'Clipulse ダッシュボードへログイン',
    'login.heading': '保護された Clipulse ダッシュボード',
    'login.message': 'Clipulse ダッシュボードのアクセストークンが必要です。',
    'login.help': 'この Clipulse デプロイ用のダッシュボードアクセストークンを入力してください。',
    'login.tokenLabel': 'ダッシュボードアクセストークン',
    'login.submit': 'ダッシュボードを開く',
    'login.invalidToken': 'トークンが無効です。ダッシュボードアクセストークンを確認して再試行してください。',
    'login.failed': 'ダッシュボードへのログインに失敗しました。プロキシとサーバーログを確認して再試行してください。',
    'login.networkFailed': 'Clipulse サーバーに接続できませんでした。ネットワーク経路を確認して再試行してください。',
    'unit.day.one': '日',
    'unit.day.other': '日',
    'unit.hr.one': '時間',
    'unit.hr.other': '時間',
    'unit.min.one': '分',
    'unit.min.other': '分',
    'unit.sec.one': '秒',
    'unit.sec.other': '秒',
  },
  ko: {
    'nav.home': '홈',
    'nav.project': '프로젝트',
    'nav.session': '세션',
    'locale.label': '언어',
    'button.logout': '로그아웃',
    'button.loggingOut': '로그아웃 중...',
    'button.returnToSignIn': '로그인으로 돌아가기',
    'button.switchAccount': '로그아웃 후 계정 전환',
    'login.title': 'Clipulse 대시보드 로그인',
    'login.heading': '보호된 Clipulse 대시보드',
    'login.message': 'Clipulse 대시보드 액세스 토큰이 필요합니다.',
    'login.help': '이 Clipulse 배포의 대시보드 액세스 토큰을 입력하세요.',
    'login.tokenLabel': '대시보드 액세스 토큰',
    'login.submit': '대시보드 열기',
  },
  de: {
    'nav.home': 'Start',
    'nav.project': 'Projekt',
    'nav.session': 'Sitzung',
    'locale.label': 'Sprache',
    'button.logout': 'Abmelden',
    'button.loggingOut': 'Abmeldung läuft...',
    'button.returnToSignIn': 'Zur Anmeldung zurück',
    'button.switchAccount': 'Abmelden und Konto wechseln',
    'login.title': 'Clipulse-Dashboard-Anmeldung',
    'login.heading': 'Geschütztes Clipulse-Dashboard',
    'login.message': 'Das Zugriffstoken für das Clipulse-Dashboard ist erforderlich.',
    'login.help': 'Gib das Zugriffstoken für dieses Clipulse-Deployment ein.',
    'login.tokenLabel': 'Dashboard-Zugriffstoken',
    'login.submit': 'Dashboard öffnen',
  },
  fr: {
    'nav.home': 'Accueil',
    'nav.project': 'Projet',
    'nav.session': 'Session',
    'locale.label': 'Langue',
    'button.logout': 'Se déconnecter',
    'button.loggingOut': 'Déconnexion...',
    'button.returnToSignIn': 'Retour à la connexion',
    'button.switchAccount': 'Se déconnecter et changer de compte',
    'login.title': 'Connexion au dashboard Clipulse',
    'login.heading': 'Dashboard Clipulse protégé',
    'login.message': "Le jeton d'accès au dashboard Clipulse est requis.",
    'login.help': "Saisissez le jeton d'accès au dashboard pour cette installation Clipulse.",
    'login.tokenLabel': "Jeton d'accès au dashboard",
    'login.submit': 'Ouvrir le dashboard',
  },
  ru: {
    'nav.home': 'Главная',
    'nav.project': 'Проект',
    'nav.session': 'Сессия',
    'locale.label': 'Язык',
    'button.logout': 'Выйти',
    'button.loggingOut': 'Выход...',
    'button.returnToSignIn': 'Вернуться ко входу',
    'button.switchAccount': 'Выйти и сменить аккаунт',
    'login.title': 'Вход в dashboard Clipulse',
    'login.heading': 'Защищённый dashboard Clipulse',
    'login.message': 'Требуется токен доступа к dashboard Clipulse.',
    'login.help': 'Введите токен доступа к dashboard для этого развёртывания Clipulse.',
    'login.tokenLabel': 'Токен доступа к dashboard',
    'login.submit': 'Открыть dashboard',
  },
  hi: {
    'nav.home': 'होम',
    'nav.project': 'प्रोजेक्ट',
    'nav.session': 'सेशन',
    'locale.label': 'भाषा',
    'button.logout': 'लॉग आउट',
    'button.loggingOut': 'लॉग आउट हो रहा है...',
    'button.returnToSignIn': 'साइन-इन पर लौटें',
    'button.switchAccount': 'लॉग आउट करें और खाता बदलें',
    'login.title': 'Clipulse डैशबोर्ड लॉगिन',
    'login.heading': 'सुरक्षित Clipulse डैशबोर्ड',
    'login.message': 'Clipulse डैशबोर्ड एक्सेस टोकन आवश्यक है।',
    'login.help': 'इस Clipulse डिप्लॉयमेंट के लिए डैशबोर्ड एक्सेस टोकन दर्ज करें।',
    'login.tokenLabel': 'डैशबोर्ड एक्सेस टोकन',
    'login.submit': 'डैशबोर्ड खोलें',
  },
  id: {
    'nav.home': 'Beranda',
    'nav.project': 'Proyek',
    'nav.session': 'Sesi',
    'locale.label': 'Bahasa',
    'button.logout': 'Keluar',
    'button.loggingOut': 'Sedang keluar...',
    'button.returnToSignIn': 'Kembali ke masuk',
    'button.switchAccount': 'Keluar dan ganti akun',
    'login.title': 'Masuk ke Dashboard Clipulse',
    'login.heading': 'Dashboard Clipulse terlindungi',
    'login.message': 'Token akses dashboard Clipulse diperlukan.',
    'login.help': 'Masukkan token akses dashboard untuk deployment Clipulse ini.',
    'login.tokenLabel': 'Token akses dashboard',
    'login.submit': 'Buka dashboard',
  },
  tr: {
    'nav.home': 'Ana sayfa',
    'nav.project': 'Proje',
    'nav.session': 'Oturum',
    'locale.label': 'Dil',
    'button.logout': 'Çıkış yap',
    'button.loggingOut': 'Çıkış yapılıyor...',
    'button.returnToSignIn': 'Girişe dön',
    'button.switchAccount': 'Çıkış yap ve hesap değiştir',
    'login.title': 'Clipulse Dashboard Girişi',
    'login.heading': 'Korumalı Clipulse dashboard',
    'login.message': 'Clipulse dashboard erişim belirteci gereklidir.',
    'login.help': 'Bu Clipulse kurulumu için dashboard erişim belirtecini girin.',
    'login.tokenLabel': 'Dashboard erişim belirteci',
    'login.submit': 'Dashboard’u aç',
  },
  it: {
    'nav.home': 'Home',
    'nav.project': 'Progetto',
    'nav.session': 'Sessione',
    'locale.label': 'Lingua',
    'button.logout': 'Esci',
    'button.loggingOut': 'Uscita in corso...',
    'button.returnToSignIn': 'Torna al login',
    'button.switchAccount': 'Esci e cambia account',
    'login.title': 'Accesso al dashboard Clipulse',
    'login.heading': 'Dashboard Clipulse protetto',
    'login.message': 'È richiesto il token di accesso al dashboard Clipulse.',
    'login.help': 'Inserisci il token di accesso al dashboard per questa installazione di Clipulse.',
    'login.tokenLabel': 'Token di accesso al dashboard',
    'login.submit': 'Apri dashboard',
  },
  nl: {
    'nav.home': 'Start',
    'nav.project': 'Project',
    'nav.session': 'Sessie',
    'locale.label': 'Taal',
    'button.logout': 'Uitloggen',
    'button.loggingOut': 'Bezig met uitloggen...',
    'button.returnToSignIn': 'Terug naar inloggen',
    'button.switchAccount': 'Uitloggen en account wisselen',
    'login.title': 'Clipulse-dashboard aanmelden',
    'login.heading': 'Beveiligd Clipulse-dashboard',
    'login.message': 'Het Clipulse-dashboardtoegangstoken is vereist.',
    'login.help': 'Voer het dashboardtoegangstoken voor deze Clipulse-deployment in.',
    'login.tokenLabel': 'Dashboardtoegangstoken',
    'login.submit': 'Dashboard openen',
  },
}

const TEXT_TO_KEY = {
  Home: 'nav.home',
  Project: 'nav.project',
  Session: 'nav.session',
  Language: 'locale.label',
  'Log out': 'button.logout',
  'Logging out...': 'button.loggingOut',
  'Return to sign-in': 'button.returnToSignIn',
  'Log out and switch account': 'button.switchAccount',
  'Protected dashboard session active.': 'auth.active',
  Overview: 'section.overview',
  Languages: 'section.languages',
  Models: 'section.models',
  Hosts: 'section.hosts',
  Projects: 'section.projects',
  'Recent Sessions': 'section.recentSessions',
  'Project Sessions': 'section.projectSessions',
  'Related Sessions': 'section.relatedSessions',
  'Related Sessions (recent feed fallback)': 'section.relatedSessionsFallback',
  'Daily Activity': 'section.dailyActivity',
  Details: 'section.details',
  Status: 'label.status',
  Hint: 'label.hint',
  'Project ref': 'label.projectRef',
  'Active time': 'label.activeTime',
  'Wait time': 'label.waitTime',
  Events: 'label.events',
  'Route summary': 'label.routeSummary',
  Sessions: 'label.sessions',
  'Changed files': 'label.changedFiles',
  'Line changes': 'label.lineChanges',
  'Primary host-model': 'label.primaryHostModel',
  'Host maturity': 'label.hostMaturity',
  'Host-model mix': 'label.hostModelMix',
  'Coverage note': 'label.coverageNote',
  'File identifiers': 'label.fileIdentifiers',
  'Last event type': 'label.lastEventType',
  'Last event': 'label.lastEvent',
  'Project sessions': 'label.projectSessions',
  Project: 'nav.project',
  Compatibility: 'label.compatibility',
  'Compatibility mode': 'label.compatibilityMode',
  'Compatibility source': 'label.compatibilitySource',
  'Compatibility scope': 'label.compatibilityScope',
  'Fallback sections': 'label.fallbackSections',
  'Affected fields': 'label.affectedFields',
  'Contract meta': 'label.contractMeta',
  'Dashboard compatibility': 'label.dashboardCompatibility',
  'Queue status': 'label.queueStatus',
  'Status metadata': 'label.statusMetadata',
  'Data completeness': 'label.dataCompleteness',
  'Related feed': 'label.relatedFeed',
  State: 'label.state',
  'First event': 'label.firstEvent',
  'Last host': 'label.lastHost',
  'Observed host': 'label.observedHost',
  'Last model': 'label.lastModel',
  'Observed model': 'label.observedModel',
  'Last branch': 'label.lastBranch',
  'Observed branch': 'label.observedBranch',
  'Runtime profile': 'label.runtimeProfile',
  'Operator summary': 'label.operatorSummary',
  'Queue note': 'label.queueNote',
  'Loading...': 'message.loading',
  'Loading overview...': 'message.loadingOverview',
  'Loading language data...': 'message.loadingLanguageData',
  'Loading model data...': 'message.loadingModelData',
  'Loading host data...': 'message.loadingHostData',
  'Loading project data...': 'message.loadingProjectData',
  'Loading recent sessions...': 'message.loadingRecentSessions',
  'Loading project sessions...': 'message.loadingProjectSessions',
  'Loading related sessions...': 'message.loadingRelatedSessions',
  'Loading daily activity...': 'message.loadingDailyActivity',
  'Sign in again to reload private dashboard data.': 'message.signInReloadPrivate',
  'Sign in again to reload language data.': 'message.signInReloadLanguage',
  'Sign in again to reload model data.': 'message.signInReloadModel',
  'Sign in again to reload host data.': 'message.signInReloadHost',
  'Sign in again to load project data.': 'message.signInLoadProject',
  'Sign in again to load recent sessions.': 'message.signInLoadRecentSessions',
  'Sign in again to reload daily activity.': 'message.signInReloadDaily',
  'Dashboard signed out': 'message.dashboardSignedOut',
  'Private dashboard data was cleared from this page after logout.': 'message.signedOutDescription',
  'Signed out successfully.': 'message.signedOutSuccess',
  'Sign in again to load private dashboard data.': 'message.signedOutHint',
  'No daily activity yet.': 'message.noDailyActivityYet',
  'Not recorded yet': 'message.notRecordedYet',
}
const PREFIX_TO_KEY = {
  Project: 'nav.project',
  Session: 'nav.session',
  'Total events': 'metric.totalEvents',
  'Total active': 'metric.totalActive',
  'Total wait': 'metric.totalWait',
  'Today active': 'metric.todayActive',
  'This week active': 'metric.thisWeekActive',
}

let currentLocale = DEFAULT_LOCALE

function getMessages(locale) {
  const loginMessages = Object.fromEntries(
    Object.entries(DASHBOARD_LOGIN_TRANSLATIONS[locale] ?? {}).flatMap(([key, value]) => {
      const messageKey = LOGIN_COPY_TO_MESSAGE_KEYS[key]
      return typeof messageKey === 'string' && typeof value === 'string'
        ? [[messageKey, value]]
        : []
    }),
  )

  return {
    ...EN_MESSAGES,
    ...(LOCALE_MESSAGES[locale] ?? {}),
    ...loginMessages,
  }
}

export function getLocaleOptions() {
  return [...LOCALE_OPTIONS]
}

export function normalizeDashboardLocale(value) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return null
  }

  const normalized = value.trim().replace(/_/g, '-')
  const lower = normalized.toLowerCase()

  if (lower === 'en' || lower.startsWith('en-')) {
    return 'en'
  }
  if (lower === 'zh-tw' || lower === 'zh-hk' || lower === 'zh-mo' || lower.startsWith('zh-hant')) {
    return 'zh-TW'
  }
  if (lower === 'zh-cn' || lower === 'zh-sg' || lower.startsWith('zh-hans') || lower.startsWith('zh-')) {
    return 'zh-CN'
  }
  if (lower === 'pt-br' || lower.startsWith('pt-')) {
    return 'pt-BR'
  }

  const match = SUPPORTED_LOCALES.find((locale) => locale.toLowerCase() === lower)
  if (match) {
    return match
  }

  const baseMatch = SUPPORTED_LOCALES.find((locale) => locale.toLowerCase() === lower.split('-')[0])
  return baseMatch ?? null
}

function parseCookiePairs(cookieHeader) {
  if (typeof cookieHeader !== 'string' || cookieHeader.trim().length === 0) {
    return []
  }

  return cookieHeader.split(';')
    .map((item) => item.trim())
    .filter(Boolean)
}

export function readLocaleCookie(cookieHeader) {
  let matchedLocale = null

  for (const entry of parseCookiePairs(cookieHeader)) {
    const [name, ...rest] = entry.split('=')
    if (![LOCALE_COOKIE_NAME, ...LEGACY_LOCALE_COOKIE_NAMES].includes(name?.trim() ?? '')) {
      continue
    }

    const normalizedLocale = normalizeDashboardLocale(rest.join('='))
    if (normalizedLocale) {
      matchedLocale = normalizedLocale
    }
  }

  return matchedLocale
}

export function resolveDashboardLocale({ cookieHeader = '', navigatorLanguages = [] } = {}) {
  const cookieLocale = readLocaleCookie(cookieHeader)
  if (cookieLocale) {
    return cookieLocale
  }

  for (const candidate of Array.isArray(navigatorLanguages) ? navigatorLanguages : []) {
    const normalized = normalizeDashboardLocale(candidate)
    if (normalized) {
      return normalized
    }
  }

  return DEFAULT_LOCALE
}

export function getCurrentLocale() {
  return currentLocale
}

export function setCurrentLocale(locale, { doc } = {}) {
  currentLocale = normalizeDashboardLocale(locale) ?? DEFAULT_LOCALE
  if (doc?.documentElement) {
    doc.documentElement.lang = currentLocale
  }
  return currentLocale
}

function normalizeLocaleCookiePath(path) {
  if (typeof path !== 'string' || path.trim().length === 0 || path === '/') {
    return '/'
  }

  const normalizedPath = path.trim().replace(/\/+$/, '')
  return normalizedPath.length > 0 ? normalizedPath : '/'
}

export function writeLocaleCookie(doc, locale, path = '/') {
  if (!doc) {
    return
  }

  const normalizedLocale = normalizeDashboardLocale(locale) ?? DEFAULT_LOCALE
  const normalizedPath = normalizeLocaleCookiePath(path)
  doc.cookie = `${LOCALE_COOKIE_NAME}=${normalizedLocale}; Path=${normalizedPath}; Max-Age=31536000; SameSite=Lax`

  if (normalizedPath !== '/') {
    doc.cookie = `${LOCALE_COOKIE_NAME}=; Path=/; Max-Age=0; SameSite=Lax`
    for (const legacyCookieName of LEGACY_LOCALE_COOKIE_NAMES) {
      doc.cookie = `${legacyCookieName}=; Path=/; Max-Age=0; SameSite=Lax`
    }
  }
}

export function t(key, locale = currentLocale) {
  return getMessages(locale)[key] ?? EN_MESSAGES[key] ?? key
}

export function translateText(text, locale = currentLocale) {
  if (typeof text !== 'string' || text.length === 0 || locale === 'en') {
    return text
  }

  const directKey = TEXT_TO_KEY[text]
  if (directKey) {
    return t(directKey, locale)
  }

  const colonMatch = text.match(/^([^:]+):\s(.+)$/)
  if (colonMatch) {
    const prefix = colonMatch[1]
    const translatedPrefix = PREFIX_TO_KEY[prefix]
      ? t(PREFIX_TO_KEY[prefix], locale)
      : TEXT_TO_KEY[prefix]
        ? t(TEXT_TO_KEY[prefix], locale)
        : prefix
    if (translatedPrefix !== prefix) {
      return `${translatedPrefix}: ${colonMatch[2]}`
    }
  }

  if (text === 'Home overview') {
    return locale === 'ja' ? 'ホーム概要' : locale === 'de' ? 'Startübersicht' : t('nav.home', locale)
  }
  if (text === 'Project overview') {
    return `${t('nav.project', locale)} overview`
  }
  if (text === 'Session overview') {
    return `${t('nav.session', locale)} overview`
  }

  return text
}

export function getDurationUnit(locale, unit, value) {
  const normalizedLocale = normalizeDashboardLocale(locale) ?? DEFAULT_LOCALE
  const pluralKey = value === 1 ? `${unit}.one` : `${unit}.other`
  return t(`unit.${pluralKey}`, normalizedLocale)
}
