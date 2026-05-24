export const DEFAULT_LOCALE = 'zh-CN'
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

export const DASHBOARD_LOGIN_TRANSLATIONS = {
  en: {
    title: 'Clipulse Dashboard Login',
    heading: 'Protected Clipulse dashboard',
    message: 'Clipulse dashboard access token is required.',
    help: 'Enter the dashboard access token for this Clipulse deployment.',
    token_label: 'Dashboard access token',
    submit: 'Open dashboard',
    invalid_token: 'Invalid token. Check the dashboard access token and try again.',
    failed: 'Dashboard login failed. Check the proxy and server logs, then retry.',
    network_failed: 'Could not reach the Clipulse server. Check the network path and retry.',
    language: 'Language',
    invalid_token_api_message: 'dashboard access token is invalid',
    invalid_token_api_hint: 'Provide the configured Clipulse dashboard access token and try again.',
  },
  'zh-CN': {
    title: 'Clipulse 控制台登录',
    heading: '受保护的 Clipulse 控制台',
    message: '需要 Clipulse 控制台访问 token。',
    help: '请输入这个 Clipulse 部署的控制台访问 token。',
    token_label: '控制台访问 token',
    submit: '打开控制台',
    invalid_token: 'Token 无效，请检查控制台访问 token 后重试。',
    failed: '控制台登录失败，请检查代理和服务端日志后再试。',
    network_failed: '无法连到 Clipulse 服务，请检查网络路径后重试。',
    language: '语言',
    invalid_token_api_message: '控制台访问 token 无效',
    invalid_token_api_hint: '请提供已配置的 Clipulse 控制台访问 token 后重试。',
  },
  'zh-TW': {
    title: 'Clipulse Dashboard 登入',
    heading: '受保護的 Clipulse dashboard',
    message: '需要 Clipulse dashboard 存取 token。',
    help: '請輸入這個 Clipulse 部署的 dashboard 存取 token。',
    token_label: 'Dashboard 存取 token',
    submit: '打開 dashboard',
    invalid_token: 'Token 無效，請檢查 dashboard 存取 token 後再試一次。',
    failed: 'Dashboard 登入失敗，請檢查代理與伺服器日誌後再試一次。',
    network_failed: '無法連上 Clipulse 伺服器，請檢查網路路徑後再試一次。',
    language: '語言',
    invalid_token_api_message: 'dashboard 存取 token 無效',
    invalid_token_api_hint: '請提供已設定的 Clipulse dashboard 存取 token 後再試一次。',
  },
  es: {
    title: 'Inicio de sesión de Clipulse Dashboard',
    heading: 'Dashboard protegido de Clipulse',
    message: 'Se requiere el token de acceso del dashboard de Clipulse.',
    help: 'Introduce el token de acceso del dashboard para esta instalación de Clipulse.',
    token_label: 'Token de acceso del dashboard',
    submit: 'Abrir dashboard',
    invalid_token: 'El token no es válido. Verifica el token de acceso del dashboard y vuelve a intentarlo.',
    failed: 'No se pudo iniciar sesión en el dashboard. Revisa el proxy y los logs del servidor, y vuelve a intentarlo.',
    network_failed: 'No se pudo conectar con el servidor de Clipulse. Revisa la ruta de red y vuelve a intentarlo.',
    language: 'Idioma',
    invalid_token_api_message: 'el token de acceso del dashboard no es válido',
    invalid_token_api_hint: 'Proporciona el token de acceso configurado para el dashboard de Clipulse y vuelve a intentarlo.',
  },
  'pt-BR': {
    title: 'Login do Clipulse Dashboard',
    heading: 'Dashboard protegido do Clipulse',
    message: 'O token de acesso do dashboard do Clipulse é obrigatório.',
    help: 'Digite o token de acesso do dashboard para esta instalação do Clipulse.',
    token_label: 'Token de acesso do dashboard',
    submit: 'Abrir dashboard',
    invalid_token: 'O token é inválido. Verifique o token de acesso do dashboard e tente novamente.',
    failed: 'Falha no login do dashboard. Verifique o proxy e os logs do servidor e tente novamente.',
    network_failed: 'Não foi possível alcançar o servidor do Clipulse. Verifique o caminho de rede e tente novamente.',
    language: 'Idioma',
    invalid_token_api_message: 'o token de acesso do dashboard é inválido',
    invalid_token_api_hint: 'Informe o token de acesso configurado para o dashboard do Clipulse e tente novamente.',
  },
  ja: {
    title: 'Clipulse ダッシュボードへログイン',
    heading: '保護された Clipulse ダッシュボード',
    message: 'Clipulse ダッシュボードのアクセストークンが必要です。',
    help: 'この Clipulse デプロイ用のダッシュボードアクセストークンを入力してください。',
    token_label: 'ダッシュボードアクセストークン',
    submit: 'ダッシュボードを開く',
    invalid_token: 'トークンが無効です。ダッシュボードアクセストークンを確認して再試行してください。',
    failed: 'ダッシュボードへのログインに失敗しました。プロキシとサーバーログを確認して再試行してください。',
    network_failed: 'Clipulse サーバーに接続できませんでした。ネットワーク経路を確認して再試行してください。',
    language: '言語',
    invalid_token_api_message: 'ダッシュボードアクセストークンが無効です',
    invalid_token_api_hint: '設定済みの Clipulse ダッシュボードアクセストークンを入力して再試行してください。',
  },
  ko: {
    title: 'Clipulse 대시보드 로그인',
    heading: '보호된 Clipulse 대시보드',
    message: 'Clipulse 대시보드 액세스 토큰이 필요합니다.',
    help: '이 Clipulse 배포의 대시보드 액세스 토큰을 입력하세요.',
    token_label: '대시보드 액세스 토큰',
    submit: '대시보드 열기',
    invalid_token: '잘못된 토큰입니다. 대시보드 액세스 토큰을 확인한 뒤 다시 시도하세요.',
    failed: '대시보드 로그인에 실패했습니다. 프록시와 서버 로그를 확인한 뒤 다시 시도하세요.',
    network_failed: 'Clipulse 서버에 연결할 수 없습니다. 네트워크 경로를 확인한 뒤 다시 시도하세요.',
    language: '언어',
    invalid_token_api_message: '대시보드 액세스 토큰이 올바르지 않습니다',
    invalid_token_api_hint: '설정된 Clipulse 대시보드 액세스 토큰을 입력한 뒤 다시 시도하세요.',
  },
  de: {
    title: 'Clipulse-Dashboard-Anmeldung',
    heading: 'Geschütztes Clipulse-Dashboard',
    message: 'Das Zugriffstoken für das Clipulse-Dashboard ist erforderlich.',
    help: 'Gib das Zugriffstoken für dieses Clipulse-Deployment ein.',
    token_label: 'Dashboard-Zugriffstoken',
    submit: 'Dashboard öffnen',
    invalid_token: 'Das Token ist ungültig. Prüfe das Dashboard-Zugriffstoken und versuche es erneut.',
    failed: 'Die Dashboard-Anmeldung ist fehlgeschlagen. Prüfe den Proxy und die Server-Logs und versuche es erneut.',
    network_failed: 'Der Clipulse-Server konnte nicht erreicht werden. Prüfe den Netzwerkpfad und versuche es erneut.',
    language: 'Sprache',
    invalid_token_api_message: 'das Dashboard-Zugriffstoken ist ungültig',
    invalid_token_api_hint: 'Sende das konfigurierte Zugriffstoken für das Clipulse-Dashboard und versuche es erneut.',
  },
  fr: {
    title: 'Connexion au dashboard Clipulse',
    heading: 'Dashboard Clipulse protégé',
    message: "Le jeton d'accès au dashboard Clipulse est requis.",
    help: "Saisissez le jeton d'accès au dashboard pour cette installation Clipulse.",
    token_label: "Jeton d'accès au dashboard",
    submit: 'Ouvrir le dashboard',
    invalid_token: "Le jeton est invalide. Vérifiez le jeton d'accès au dashboard et réessayez.",
    failed: 'La connexion au dashboard a échoué. Vérifiez le proxy et les logs du serveur, puis réessayez.',
    network_failed: 'Impossible de joindre le serveur Clipulse. Vérifiez le chemin réseau, puis réessayez.',
    language: 'Langue',
    invalid_token_api_message: "le jeton d'accès au dashboard est invalide",
    invalid_token_api_hint: "Fournissez le jeton d'accès configuré pour le dashboard Clipulse, puis réessayez.",
  },
  ru: {
    title: 'Вход в dashboard Clipulse',
    heading: 'Защищённый dashboard Clipulse',
    message: 'Требуется токен доступа к dashboard Clipulse.',
    help: 'Введите токен доступа к dashboard для этого развёртывания Clipulse.',
    token_label: 'Токен доступа к dashboard',
    submit: 'Открыть dashboard',
    invalid_token: 'Токен недействителен. Проверьте токен доступа к dashboard и попробуйте снова.',
    failed: 'Не удалось войти в dashboard. Проверьте прокси и журналы сервера, затем попробуйте снова.',
    network_failed: 'Не удалось связаться с сервером Clipulse. Проверьте сетевой маршрут и попробуйте снова.',
    language: 'Язык',
    invalid_token_api_message: 'токен доступа к dashboard недействителен',
    invalid_token_api_hint: 'Передайте настроенный токен доступа к dashboard Clipulse и попробуйте снова.',
  },
  hi: {
    title: 'Clipulse डैशबोर्ड लॉगिन',
    heading: 'सुरक्षित Clipulse डैशबोर्ड',
    message: 'Clipulse डैशबोर्ड एक्सेस टोकन आवश्यक है।',
    help: 'इस Clipulse डिप्लॉयमेंट के लिए डैशबोर्ड एक्सेस टोकन दर्ज करें।',
    token_label: 'डैशबोर्ड एक्सेस टोकन',
    submit: 'डैशबोर्ड खोलें',
    invalid_token: 'टोकन अमान्य है। डैशबोर्ड एक्सेस टोकन जांचें और फिर से कोशिश करें।',
    failed: 'डैशबोर्ड लॉगिन विफल रहा। प्रॉक्सी और सर्वर लॉग जांचें, फिर दोबारा कोशिश करें।',
    network_failed: 'Clipulse सर्वर तक पहुंचा नहीं जा सका। नेटवर्क पथ जांचें और फिर से कोशिश करें।',
    language: 'भाषा',
    invalid_token_api_message: 'डैशबोर्ड एक्सेस टोकन अमान्य है',
    invalid_token_api_hint: 'कॉन्फ़िगर किया गया Clipulse डैशबोर्ड एक्सेस टोकन भेजें और फिर से कोशिश करें।',
  },
  id: {
    title: 'Masuk ke Dashboard Clipulse',
    heading: 'Dashboard Clipulse terlindungi',
    message: 'Token akses dashboard Clipulse diperlukan.',
    help: 'Masukkan token akses dashboard untuk deployment Clipulse ini.',
    token_label: 'Token akses dashboard',
    submit: 'Buka dashboard',
    invalid_token: 'Token tidak valid. Periksa token akses dashboard lalu coba lagi.',
    failed: 'Login dashboard gagal. Periksa proxy dan log server lalu coba lagi.',
    network_failed: 'Tidak dapat menjangkau server Clipulse. Periksa jalur jaringan lalu coba lagi.',
    language: 'Bahasa',
    invalid_token_api_message: 'token akses dashboard tidak valid',
    invalid_token_api_hint: 'Kirim token akses dashboard Clipulse yang sudah dikonfigurasi lalu coba lagi.',
  },
  tr: {
    title: 'Clipulse Dashboard Girişi',
    heading: 'Korumalı Clipulse dashboard',
    message: 'Clipulse dashboard erişim belirteci gereklidir.',
    help: 'Bu Clipulse kurulumu için dashboard erişim belirtecini girin.',
    token_label: 'Dashboard erişim belirteci',
    submit: 'Dashboard’u aç',
    invalid_token: 'Belirteç geçersiz. Dashboard erişim belirtecini kontrol edip yeniden deneyin.',
    failed: "Dashboard oturumu açılamadı. Proxy'yi ve sunucu günlüklerini kontrol edip yeniden deneyin.",
    network_failed: 'Clipulse sunucusuna ulaşılamadı. Ağ yolunu kontrol edip yeniden deneyin.',
    language: 'Dil',
    invalid_token_api_message: 'dashboard erişim belirteci geçersiz',
    invalid_token_api_hint: 'Yapılandırılmış Clipulse dashboard erişim belirtecini gönderip yeniden deneyin.',
  },
  it: {
    title: 'Accesso al dashboard Clipulse',
    heading: 'Dashboard Clipulse protetto',
    message: "È richiesto il token di accesso al dashboard Clipulse.",
    help: "Inserisci il token di accesso al dashboard per questa installazione di Clipulse.",
    token_label: 'Token di accesso al dashboard',
    submit: 'Apri dashboard',
    invalid_token: 'Il token non è valido. Controlla il token di accesso al dashboard e riprova.',
    failed: 'Accesso al dashboard non riuscito. Controlla il proxy e i log del server, poi riprova.',
    network_failed: 'Impossibile raggiungere il server Clipulse. Controlla il percorso di rete e riprova.',
    language: 'Lingua',
    invalid_token_api_message: 'il token di accesso al dashboard non è valido',
    invalid_token_api_hint: 'Fornisci il token di accesso configurato per il dashboard Clipulse e riprova.',
  },
  nl: {
    title: 'Clipulse-dashboard aanmelden',
    heading: 'Beveiligd Clipulse-dashboard',
    message: 'Het Clipulse-dashboardtoegangstoken is vereist.',
    help: 'Voer het dashboardtoegangstoken voor deze Clipulse-deployment in.',
    token_label: 'Dashboardtoegangstoken',
    submit: 'Dashboard openen',
    invalid_token: 'Het token is ongeldig. Controleer het dashboardtoegangstoken en probeer het opnieuw.',
    failed: 'Aanmelden bij het dashboard is mislukt. Controleer de proxy en de serverlogs en probeer het opnieuw.',
    network_failed: 'De Clipulse-server kon niet worden bereikt. Controleer het netwerkpad en probeer het opnieuw.',
    language: 'Taal',
    invalid_token_api_message: 'het dashboardtoegangstoken is ongeldig',
    invalid_token_api_hint: 'Geef het geconfigureerde Clipulse-dashboardtoegangstoken door en probeer het opnieuw.',
  },
}

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
  'shell.brandSubtitle': 'Local',
  'shell.heroTitle': 'Local Agent CLI activity console',
  'shell.heroDescription': 'Track active time, waiting time, tokens, cost, provider status, and project/session summaries on this machine.',
  'shell.panelEyebrow': 'Local Console',
  'shell.panelStatusLabel': 'Private API',
  'shell.viewDescription.home': 'Clipulse keeps this dashboard local-first, compact, and readable for daily checks. Metrics are summary-first heuristics meant for quick inspection.',
  'shell.viewDescription.project': 'Inspect project-level rollups and recent sessions from the latest snapshot.',
  'shell.viewDescription.session': 'Inspect one logical session and its surrounding snapshot context.',
  'nav.home': 'Home',
  'nav.project': 'Project',
  'nav.session': 'Session',
  'nav.reports': 'Reports',
  'nav.providers': 'Providers',
  'nav.settings': 'Settings',
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
  'detail.authLoginTitle': 'Dashboard sign-in required',
  'detail.authLoginDescription': 'This protected dashboard needs a valid signed-in session before the frontend can load dashboard data.',
  'detail.authForbiddenTitle': 'Dashboard access blocked',
  'detail.authForbiddenDescription': 'The current signed-in account cannot open this protected dashboard. Log out and try another allowed account.',
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
  'section.reports': 'Reports',
  'section.providers': 'Providers',
  'section.settings': 'Settings',
  'view.homeTitle': 'Home overview',
  'view.projectTitle': 'Project overview',
  'view.sessionTitle': 'Session overview',
  'view.reportsTitle': 'Usage reports',
  'view.providersTitle': 'Providers and quotas',
  'view.settingsTitle': 'Local settings',
  'view.reportsDescription': 'Inspect daily token, cost, time, session, and block summaries from the private API.',
  'view.providersDescription': 'Review local provider summaries and the P0 quota contract without reading provider credentials.',
  'view.settingsDescription': 'Manage install, PWA, menubar, and privacy-oriented local settings surfaces.',
  'detail.homeDescription': 'Current Clipulse alpha snapshot across all tracked agent activity.',
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
  'message.noLanguageDataYet': 'No language data yet.',
  'message.noModelDataYet': 'No model data yet.',
  'message.noHostDataYet': 'No host data yet.',
  'message.noProjectDataYet': 'No project data yet.',
  'message.noRecentSessionsYet': 'No recent sessions yet.',
  'message.noRelatedProjectSessionsYet': 'No related sessions available for this project yet.',
  'message.noSameProjectSessionsGlobalYet': 'No same-project sessions found in the global recent feed yet.',
  'message.noRelatedSessionsYet': 'No related sessions available yet.',
  'message.noProjectSessionsYet': 'No sessions recorded for this project yet.',
  'message.relatedSessionListUnavailable': 'Related session list unavailable right now. Check the dedicated sibling sessions request.',
  'message.projectSessionListUnavailable': 'Project session list unavailable right now. The project summary above is still available. Check the dedicated project sessions request.',
  'message.dashboardLoginRequired': 'dashboard login required',
  'message.signInToContinue': 'Sign in to continue.',
  'message.dashboardAccessForbidden': 'dashboard access is forbidden for this account',
  'message.signInWithAllowedAccount': 'Log out and sign in with an allowed account.',
  'message.noReportRowsYet': 'No report rows yet',
  'message.queueClear': 'queue clear',
  'message.remoteContract': 'remote contract',
  'message.localHealthyStable': 'healthy local stable',
  'message.notRecordedYet': 'Not recorded yet',
  'metric.totalEvents': 'Total events',
  'metric.totalActive': 'Total active',
  'metric.totalWait': 'Total wait',
  'metric.todayActive': 'Today active',
  'metric.thisWeekActive': 'This week active',
  'report.tokensToday': 'tokens today',
  'report.costEstimate': 'cost estimate',
  'report.activeWait': 'active / wait',
  'report.rowsLatest': 'rows / latest',
  'report.tokensTodayLabel': 'Tokens today',
  'report.rows': 'Rows',
  'provider.summaries': 'Provider summaries',
  'provider.observedLocally': 'Observed locally',
  'provider.polling': 'Polling',
  'provider.disabledP0': 'disabled in P0',
  'provider.notObserved': 'not observed',
  'provider.unknown': 'unknown',
  'settings.menubar': 'Menubar',
  'settings.enabled': 'enabled',
  'settings.disabled': 'disabled',
  'settings.view': 'view',
  'settings.refresh': 'Refresh',
  'settings.visibleMetrics': 'Visible metrics',
  'settings.pwaCache': 'PWA shell assets are safe static files; private API responses stay network-only.',
  'settings.menubarApi': 'Menubar API',
  'settings.menubarView': 'Menubar view',
  'settings.refreshInterval': 'Refresh interval',
  'settings.pwaCacheLabel': 'PWA cache',
  'settings.staticShellOnly': 'static shell assets only',
  'detail.reportsDescription': 'Daily reports are rendered from the private P0 usage report API.',
  'detail.providersDescription': 'Provider cards are local summaries in P0; real provider polling remains disabled.',
  'detail.settingsDescription': 'Menubar preferences and PWA install assets are exposed through private local surfaces.',
  'label.runtime': 'Runtime',
  'label.queueStorage': 'Queue storage',
  'label.flushHealth': 'Flush health',
  'label.localDiagnostics': 'Local diagnostics',
  'label.costEstimate': 'Cost estimate',
  'system.apiOk': 'API ok',
  'system.apiUnavailable': 'API unavailable',
  'system.dbOk': 'DB ok',
  'system.dbUnavailable': 'DB unavailable',
  'queue.noPayloadBacklogEntries': 'No payload backlog entries',
  'queue.serverLocalPathRedacted': 'server-local path redacted',
  'queue.statusDegraded': 'status degraded',
  'queue.noLocalStateYet': 'no local state yet',
  'queue.processingOnly': 'processing only',
  'queue.quarantinePresent': 'quarantine present',
  'queue.mixedBacklog': 'mixed backlog',
  'queue.pendingBacklog': 'pending backlog',
  'contract.remoteLoaded': 'remote contract loaded.',
  'contract.remoteMode': 'remote',
  'contract.fallbackActive': 'fallback active',
  'contract.refreshPending': 'refresh pending',
  'contract.builtInFallback': 'built-in fallback',
  'state.attention': 'attention',
  'state.partial': 'partial',
  'state.unavailable': 'unavailable',
  'state.healthyLocalStable': 'healthy local stable',
  'state.summaryFeedsDegraded': 'summary feeds degraded',
  'state.compatibilityFallbackActive': 'compatibility fallback active',
  'state.operatorAttentionRequired': 'operator attention required',
  'state.backlogPending': 'backlog pending',
  'state.experimentalActivity': 'experimental activity',
  'state.mixedStableExperimentalActivity': 'mixed stable + experimental activity',
  'message.noProviderSummariesYet': 'No provider summaries yet. Usage events will populate local provider cards.',
  'message.loadingUsageReports': 'Loading usage reports...',
  'message.loadingProviderSummaries': 'Loading provider summaries...',
  'message.loadingMenubarSettings': 'Loading menubar settings...',
  'message.unableLoadUsageReports': 'Unable to load usage reports yet.',
  'message.unableLoadProviderSummaries': 'Unable to load provider summaries yet.',
  'message.unableLoadMenubarSettings': 'Unable to load menubar settings yet.',
  'message.invalidUsageReportPayload': 'Invalid usage report payload.',
  'message.invalidProvidersPayload': 'Invalid providers payload.',
  'message.invalidMenubarPreferencesPayload': 'Invalid menubar preferences payload.',
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
    'shell.brandSubtitle': '本地',
    'shell.heroTitle': '本地 Agent CLI 活动控制台',
    'shell.heroDescription': '追踪活跃时间、等待时间、Token、费用、Provider 状态和项目会话汇总。',
    'shell.panelEyebrow': '本地控制台',
    'shell.panelStatusLabel': '私有 API',
    'shell.viewDescription.home': '面向日常检查的本地优先概览，优先展示关键状态、Token、费用和最近活动。',
    'shell.viewDescription.project': '查看项目维度的活动、语言、模型和最近会话汇总。',
    'shell.viewDescription.session': '查看单个逻辑会话及其相关上下文。',
    'nav.home': '首页',
    'nav.project': '项目',
    'nav.session': '会话',
    'nav.reports': '报表',
    'nav.providers': 'Provider',
    'nav.settings': '设置',
    'locale.label': '语言',
    'button.logout': '退出登录',
    'button.loggingOut': '正在退出...',
    'button.returnToSignIn': '返回登录页',
    'button.switchAccount': '退出并切换账号',
    'auth.active': '受保护控制台会话已激活。',
    'auth.signInRequired': '这个受保护控制台需要重新登录后再刷新。',
    'auth.accessBlocked': '当前账号被拒绝访问。请退出后切换账号。',
    'auth.unavailable': '暂时无法确认控制台鉴权状态，请检查 API 与控制台版本兼容性。',
    'auth.signedOut': '已退出登录。重新登录即可再次打开受保护控制台。',
    'auth.logoutFailed': '退出失败，请重试。',
    'auth.signingOut': '正在退出受保护控制台...',
    'detail.authLoginTitle': '需要登录控制台',
    'detail.authLoginDescription': '这个受保护控制台需要有效的登录 session，前端才能加载私有数据。',
    'detail.authForbiddenTitle': '控制台访问被拒绝',
    'detail.authForbiddenDescription': '当前登录账号不能打开这个受保护控制台。请退出后使用允许的账号登录。',
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
    'section.reports': '报表',
    'section.providers': 'Provider',
    'section.settings': '设置',
    'view.homeTitle': '首页概览',
    'view.projectTitle': '项目概览',
    'view.sessionTitle': '会话概览',
    'view.reportsTitle': '使用报表',
    'view.providersTitle': 'Provider 与配额',
    'view.settingsTitle': '本地设置',
    'view.reportsDescription': '查看私有 API 汇总的每日 Token、费用、时间、会话和 block 数据。',
    'view.providersDescription': '查看本地 Provider 汇总和 P0 配额契约；不会读取 Provider credential。',
    'view.settingsDescription': '管理安装、PWA、菜单栏和隐私优先的本地设置入口。',
    'detail.homeDescription': '当前 Clipulse alpha 快照，覆盖所有已追踪的 Agent 活动。',
    'label.status': '状态',
    'label.hint': '提示',
    'label.project': '项目',
    'label.projectRef': '项目引用',
    'label.activeTime': '活跃时间',
    'label.waitTime': '等待时间',
    'label.events': '事件',
    'label.routeSummary': '路由摘要',
    'label.sessions': '会话',
    'label.changedFiles': '变更文件',
    'label.languages': '语言',
    'label.lineChanges': '代码行变更',
    'label.primaryHostModel': '主要 Host / Model',
    'label.hostMaturity': 'Host 成熟度',
    'label.hostModelMix': 'Host / Model 构成',
    'label.coverageNote': '覆盖说明',
    'label.fileIdentifiers': '文件标识',
    'label.lastEventType': '最后事件类型',
    'label.lastEvent': '最后事件',
    'label.projectSessions': '项目会话',
    'label.compatibility': '兼容性',
    'label.compatibilityMode': '兼容模式',
    'label.compatibilitySource': '兼容来源',
    'label.compatibilityScope': '兼容范围',
    'label.fallbackSections': '回退区域',
    'label.affectedFields': '受影响字段',
    'label.contractMeta': '契约元数据',
    'label.dashboardCompatibility': '控制台兼容性',
    'label.queueStatus': '队列状态',
    'label.statusMetadata': '状态元数据',
    'label.dataCompleteness': '数据完整性',
    'label.relatedFeed': '关联数据源',
    'label.state': '状态',
    'label.firstEvent': '首次事件',
    'label.lastHost': '最后 Host',
    'label.observedHost': '观测 Host',
    'label.lastModel': '最后 Model',
    'label.observedModel': '观测 Model',
    'label.lastBranch': '最后分支',
    'label.observedBranch': '观测分支',
    'label.runtimeProfile': '运行档案',
    'label.operatorSummary': '运维摘要',
    'label.queueNote': '队列说明',
    'login.title': 'Clipulse 控制台登录',
    'login.heading': '受保护的 Clipulse 控制台',
    'login.message': '需要 Clipulse 控制台访问 token。',
    'login.help': '请输入这个 Clipulse 部署的控制台访问 token。',
    'login.tokenLabel': '控制台访问 token',
    'login.submit': '打开控制台',
    'login.invalidToken': 'Token 无效，请检查控制台访问 token 后重试。',
    'login.failed': '控制台登录失败，请检查代理和服务端日志后再试。',
    'login.networkFailed': '无法连到 Clipulse 服务，请检查网络路径后重试。',
    'message.signInReloadPrivate': '请重新登录以加载私有控制台数据。',
    'message.signInLoadRecentSessions': '请重新登录以加载最近会话。',
    'message.signInReloadLanguage': '请重新登录以加载语言数据。',
    'message.signInReloadModel': '请重新登录以加载模型数据。',
    'message.signInReloadHost': '请重新登录以加载 Host 数据。',
    'message.signInLoadProject': '请重新登录以加载项目数据。',
    'message.loadingOverview': '正在加载概览...',
    'message.loadingLanguageData': '正在加载语言数据...',
    'message.loadingModelData': '正在加载模型数据...',
    'message.loadingHostData': '正在加载 Host 数据...',
    'message.loadingProjectData': '正在加载项目数据...',
    'message.loadingRecentSessions': '正在加载最近会话...',
    'message.loadingProjectSessions': '正在加载项目会话...',
    'message.loadingRelatedSessions': '正在加载关联会话...',
    'message.loadingDailyActivity': '正在加载每日活动...',
    'message.dashboardSignedOut': '控制台已退出登录',
    'message.signedOutDescription': '退出后，本页面中的私有控制台数据已清除。',
    'message.signedOutSuccess': '已退出登录。',
    'message.signedOutHint': '重新登录后即可加载私有控制台数据。',
    'message.noDailyActivityYet': '还没有每日活动数据。',
    'message.noLanguageDataYet': '还没有语言数据。',
    'message.noModelDataYet': '还没有模型数据。',
    'message.noHostDataYet': '还没有 Host 数据。',
    'message.noProjectDataYet': '还没有项目数据。',
    'message.noRecentSessionsYet': '还没有最近会话。',
    'message.noRelatedProjectSessionsYet': '这个项目还没有可关联的 session。',
    'message.noSameProjectSessionsGlobalYet': '全局最近会话里还没有同项目 session。',
    'message.noRelatedSessionsYet': '还没有关联 session。',
    'message.noProjectSessionsYet': '这个项目还没有记录 session。',
    'message.relatedSessionListUnavailable': '关联 session 列表暂时不可用。请检查专用 sibling sessions 请求。',
    'message.projectSessionListUnavailable': '项目 session 列表暂时不可用。上方项目摘要仍可查看，请检查专用项目 session 请求。',
    'message.dashboardLoginRequired': '控制台需要登录',
    'message.signInToContinue': '请登录后继续。',
    'message.dashboardAccessForbidden': '当前账号无法访问控制台',
    'message.signInWithAllowedAccount': '请退出后使用允许的账号登录。',
    'message.noReportRowsYet': '还没有报表行',
    'message.queueClear': '队列为空',
    'message.remoteContract': '远端契约',
    'message.localHealthyStable': '本地服务正常',
    'message.notRecordedYet': '尚未记录',
    'metric.totalEvents': '总事件',
    'metric.totalActive': '总活跃时间',
    'metric.totalWait': '总等待时间',
    'metric.todayActive': '今日活跃时间',
    'metric.thisWeekActive': '本周活跃时间',
    'report.tokensToday': '今日 Token',
    'report.costEstimate': '费用估算',
    'report.activeWait': '活跃 / 等待',
    'report.rowsLatest': '行数 / 最新',
    'report.tokensTodayLabel': '今日 Token',
    'report.rows': '行数',
    'provider.summaries': 'Provider 汇总',
    'provider.observedLocally': '本地已观测',
    'provider.polling': '轮询',
    'provider.disabledP0': 'P0 暂未启用',
    'provider.notObserved': '未观测',
    'provider.unknown': '未知',
    'settings.menubar': '菜单栏',
    'settings.enabled': '已启用',
    'settings.disabled': '已停用',
    'settings.view': '视图',
    'settings.refresh': '刷新',
    'settings.visibleMetrics': '可见指标',
    'settings.pwaCache': 'PWA 只缓存安全静态 shell；私有 API response 始终走网络。',
    'settings.menubarApi': '菜单栏 API',
    'settings.menubarView': '菜单栏视图',
    'settings.refreshInterval': '刷新间隔',
    'settings.pwaCacheLabel': 'PWA 缓存',
    'settings.staticShellOnly': '仅缓存静态 shell',
    'detail.reportsDescription': '每日报表来自私有 P0 usage report API。',
    'detail.providersDescription': 'Provider 卡片在 P0 使用本地汇总；真实 Provider 轮询暂未启用。',
    'detail.settingsDescription': '菜单栏偏好与 PWA 安装资产通过私有本地接口暴露。',
    'label.runtime': '运行状态',
    'label.queueStorage': '队列存储',
    'label.flushHealth': 'Flush 健康',
    'label.localDiagnostics': '本地诊断',
    'label.costEstimate': '费用估算',
    'system.apiOk': 'API 正常',
    'system.apiUnavailable': 'API 不可用',
    'system.dbOk': 'DB 正常',
    'system.dbUnavailable': 'DB 不可用',
    'queue.noPayloadBacklogEntries': '没有待处理 payload',
    'queue.serverLocalPathRedacted': '本机路径已隐藏',
    'queue.statusDegraded': '状态异常',
    'queue.noLocalStateYet': '尚未创建本地状态',
    'queue.processingOnly': '仅 processing',
    'queue.quarantinePresent': '存在 quarantine',
    'queue.mixedBacklog': '混合 backlog',
    'queue.pendingBacklog': '存在待处理 backlog',
    'contract.remoteLoaded': '远端契约已加载。',
    'contract.remoteMode': '远端',
    'contract.fallbackActive': '回退已启用',
    'contract.refreshPending': '等待刷新',
    'contract.builtInFallback': '内置回退',
    'state.attention': '需要关注',
    'state.partial': '部分可用',
    'state.unavailable': '不可用',
    'state.healthyLocalStable': '本地服务正常',
    'state.summaryFeedsDegraded': '汇总数据源异常',
    'state.compatibilityFallbackActive': '兼容回退已启用',
    'state.operatorAttentionRequired': '需要运维关注',
    'state.backlogPending': 'backlog 待处理',
    'state.experimentalActivity': '包含 experimental 活动',
    'state.mixedStableExperimentalActivity': '包含 stable 与 experimental 活动',
    'message.noProviderSummariesYet': '还没有 Provider 汇总。新的 usage event 会生成本地 Provider 卡片。',
    'message.loadingUsageReports': '正在加载使用报表...',
    'message.loadingProviderSummaries': '正在加载 Provider 汇总...',
    'message.loadingMenubarSettings': '正在加载菜单栏设置...',
    'message.unableLoadUsageReports': '暂时无法加载使用报表。',
    'message.unableLoadProviderSummaries': '暂时无法加载 Provider 汇总。',
    'message.unableLoadMenubarSettings': '暂时无法加载菜单栏设置。',
    'message.invalidUsageReportPayload': '使用报表 payload 无效。',
    'message.invalidProvidersPayload': 'Provider payload 无效。',
    'message.invalidMenubarPreferencesPayload': '菜单栏偏好 payload 无效。',
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
    'auth.active': '受保護控制台工作階段已啟用。',
    'login.title': 'Clipulse 控制台登入',
    'login.heading': '受保護的 Clipulse 控制台',
    'login.message': '需要 Clipulse 控制台存取 token。',
    'login.help': '請輸入這個 Clipulse 部署的控制台存取 token。',
    'login.tokenLabel': '控制台存取 token',
    'login.submit': '打開控制台',
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
  Reports: 'nav.reports',
  Providers: 'nav.providers',
  Settings: 'nav.settings',
  Language: 'locale.label',
  Local: 'shell.brandSubtitle',
  'Private API': 'shell.panelStatusLabel',
  'Log out': 'button.logout',
  'Logging out...': 'button.loggingOut',
  'Return to sign-in': 'button.returnToSignIn',
  'Log out and switch account': 'button.switchAccount',
  'Protected dashboard session active.': 'auth.active',
  'Sign in required for this protected dashboard. Sign in again, then reload.': 'auth.signInRequired',
  'Access blocked for the current account. Log out to switch accounts.': 'auth.accessBlocked',
  'Dashboard auth status is unavailable. Check API/dashboard version compatibility.': 'auth.unavailable',
  'Logged out. Sign in again to reopen the protected dashboard.': 'auth.signedOut',
  'Logout failed. Try again.': 'auth.logoutFailed',
  'Signing out of the protected dashboard...': 'auth.signingOut',
  'Home overview': 'view.homeTitle',
  'Project overview': 'view.projectTitle',
  'Session overview': 'view.sessionTitle',
  'Usage reports': 'view.reportsTitle',
  'Providers and quotas': 'view.providersTitle',
  'Local settings': 'view.settingsTitle',
  'Dashboard sign-in required': 'detail.authLoginTitle',
  'This protected dashboard needs a valid signed-in session before the frontend can load dashboard data.': 'detail.authLoginDescription',
  'Dashboard access blocked': 'detail.authForbiddenTitle',
  'The current signed-in account cannot open this protected dashboard. Log out and try another allowed account.': 'detail.authForbiddenDescription',
  'Clipulse keeps this dashboard local-first, compact, and readable for daily checks. Metrics are summary-first heuristics meant for quick inspection.': 'shell.viewDescription.home',
  'Inspect daily token, cost, time, session, and block summaries from the private API.': 'view.reportsDescription',
  'Review local provider summaries and the P0 quota contract without reading provider credentials.': 'view.providersDescription',
  'Manage install, PWA, menubar, and privacy-oriented local settings surfaces.': 'view.settingsDescription',
  'Current Clipulse alpha snapshot across all tracked agent activity.': 'detail.homeDescription',
  'Daily reports are rendered from the private P0 usage report API.': 'detail.reportsDescription',
  'Provider cards are local summaries in P0; real provider polling remains disabled.': 'detail.providersDescription',
  'Menubar preferences and PWA install assets are exposed through private local surfaces.': 'detail.settingsDescription',
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
  'Total events': 'metric.totalEvents',
  'Total active': 'metric.totalActive',
  'Total wait': 'metric.totalWait',
  'Today active': 'metric.todayActive',
  'This week active': 'metric.thisWeekActive',
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
  Runtime: 'label.runtime',
  'Queue storage': 'label.queueStorage',
  'Flush health': 'label.flushHealth',
  'Local diagnostics': 'label.localDiagnostics',
  'Operator summary': 'label.operatorSummary',
  'Queue note': 'label.queueNote',
  'Cost estimate': 'label.costEstimate',
  'API ok': 'system.apiOk',
  'API unavailable': 'system.apiUnavailable',
  'DB ok': 'system.dbOk',
  'DB unavailable': 'system.dbUnavailable',
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
  'Sign in again to load recent sessions.': 'message.signInLoadRecentSessions',
  'dashboard login required': 'message.dashboardLoginRequired',
  'Sign in to continue.': 'message.signInToContinue',
  'dashboard access is forbidden for this account': 'message.dashboardAccessForbidden',
  'Log out and sign in with an allowed account.': 'message.signInWithAllowedAccount',
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
  'No language data yet.': 'message.noLanguageDataYet',
  'No model data yet.': 'message.noModelDataYet',
  'No host data yet.': 'message.noHostDataYet',
  'No project data yet.': 'message.noProjectDataYet',
  'No recent sessions yet.': 'message.noRecentSessionsYet',
  'No report rows yet': 'message.noReportRowsYet',
  'queue clear': 'message.queueClear',
  'remote contract': 'message.remoteContract',
  'remote contract loaded.': 'contract.remoteLoaded',
  remote: 'contract.remoteMode',
  'fallback active': 'contract.fallbackActive',
  'refresh pending': 'contract.refreshPending',
  'built-in fallback': 'contract.builtInFallback',
  'healthy local stable': 'message.localHealthyStable',
  'summary feeds degraded': 'state.summaryFeedsDegraded',
  'compatibility fallback active': 'state.compatibilityFallbackActive',
  'operator attention required': 'state.operatorAttentionRequired',
  'backlog pending': 'state.backlogPending',
  'experimental activity': 'state.experimentalActivity',
  'mixed stable + experimental activity': 'state.mixedStableExperimentalActivity',
  attention: 'state.attention',
  partial: 'state.partial',
  unavailable: 'state.unavailable',
  'No payload backlog entries': 'queue.noPayloadBacklogEntries',
  'server-local path redacted': 'queue.serverLocalPathRedacted',
  'status degraded': 'queue.statusDegraded',
  'no local state yet': 'queue.noLocalStateYet',
  'processing only': 'queue.processingOnly',
  'quarantine present': 'queue.quarantinePresent',
  'mixed backlog': 'queue.mixedBacklog',
  'pending backlog': 'queue.pendingBacklog',
  'Not recorded yet': 'message.notRecordedYet',
  'No related sessions available for this project yet.': 'message.noRelatedProjectSessionsYet',
  'No same-project sessions found in the global recent feed yet.': 'message.noSameProjectSessionsGlobalYet',
  'No related sessions available yet.': 'message.noRelatedSessionsYet',
  'No sessions recorded for this project yet.': 'message.noProjectSessionsYet',
  'Related session list unavailable right now. Check the dedicated sibling sessions request.': 'message.relatedSessionListUnavailable',
  'Project session list unavailable right now. The project summary above is still available. Check the dedicated project sessions request.': 'message.projectSessionListUnavailable',
  'No provider summaries yet. Usage events will populate local provider cards.': 'message.noProviderSummariesYet',
  'Loading usage reports...': 'message.loadingUsageReports',
  'Loading provider summaries...': 'message.loadingProviderSummaries',
  'Loading menubar settings...': 'message.loadingMenubarSettings',
  'Unable to load usage reports yet.': 'message.unableLoadUsageReports',
  'Unable to load provider summaries yet.': 'message.unableLoadProviderSummaries',
  'Unable to load menubar settings yet.': 'message.unableLoadMenubarSettings',
  'Invalid usage report payload.': 'message.invalidUsageReportPayload',
  'Invalid providers payload.': 'message.invalidProvidersPayload',
  'Invalid menubar preferences payload.': 'message.invalidMenubarPreferencesPayload',
  'Tokens today': 'report.tokensTodayLabel',
  Rows: 'report.rows',
  'Provider summaries': 'provider.summaries',
  'Observed locally': 'provider.observedLocally',
  Polling: 'provider.polling',
  'disabled in P0': 'provider.disabledP0',
  unknown: 'provider.unknown',
  'Menubar API': 'settings.menubarApi',
  'Menubar view': 'settings.menubarView',
  'Refresh interval': 'settings.refreshInterval',
  'PWA cache': 'settings.pwaCacheLabel',
  'static shell assets only': 'settings.staticShellOnly',
}
const PREFIX_TO_KEY = {
  Project: 'nav.project',
  Session: 'nav.session',
  'Total events': 'metric.totalEvents',
  'Total active': 'metric.totalActive',
  'Total wait': 'metric.totalWait',
  'Today active': 'metric.todayActive',
  'This week active': 'metric.thisWeekActive',
  'tokens today': 'report.tokensToday',
  'cost estimate': 'report.costEstimate',
  'active / wait': 'report.activeWait',
  'rows / latest': 'report.rowsLatest',
  'not observed': 'provider.notObserved',
  Menubar: 'settings.menubar',
  enabled: 'settings.enabled',
  disabled: 'settings.disabled',
  view: 'settings.view',
  Refresh: 'settings.refresh',
  'Visible metrics': 'settings.visibleMetrics',
  'PWA shell assets are safe static files; private API responses stay network-only.': 'settings.pwaCache',
}

function isChineseLocale(locale) {
  return locale === 'zh-CN' || locale === 'zh-TW'
}

function translateDynamicText(text, locale) {
  if (!isChineseLocale(locale)) {
    return null
  }

  const countMatch = text.match(/^([0-9][0-9,.]*) (ready|processing|quarantine|event|events|file|files|language|languages|session|sessions|line|lines|row|rows|job pending|jobs pending)$/)
  if (countMatch) {
    const [, count, unit] = countMatch
    if (unit === 'ready' || unit === 'processing' || unit === 'quarantine') {
      return `${unit} ${count}`
    }
    const labels = {
      event: '个事件',
      events: '个事件',
      file: '个文件',
      files: '个文件',
      language: '种语言',
      languages: '种语言',
      session: '个会话',
      sessions: '个会话',
      line: '行',
      lines: '行',
      row: '行',
      rows: '行',
      'job pending': '个待处理任务',
      'jobs pending': '个待处理任务',
    }
    const suffix = labels[unit] ?? unit
    return suffix.startsWith('个') || suffix.startsWith('种') || suffix === '行'
      ? `${count} ${suffix}`
      : `${count} ${suffix}`
  }

  const durationStateMatch = text.match(/^(.+) (active|wait)$/)
  if (durationStateMatch) {
    const [, duration, state] = durationStateMatch
    return state === 'active' ? `${duration} 活跃` : `${duration} 等待`
  }

  const ageMatch = text.match(/^(latest event|oldest ready|oldest processing|oldest backlog|oldest quarantine|last attempt|last successful flush|oldest first seen) (.+) ago(?: \((.+)\))?$/)
  if (ageMatch) {
    const [, label, duration, state] = ageMatch
    const labels = {
      'latest event': '最近事件',
      'oldest ready': '最早 ready',
      'oldest processing': '最早 processing',
      'oldest backlog': '最早 backlog',
      'oldest quarantine': '最早 quarantine',
      'last attempt': '最近尝试',
      'last successful flush': '最近成功 flush',
      'oldest first seen': '最早发现',
    }
    return `${labels[label]}：${duration}前${state ? `（${state}）` : ''}`
  }

  const maxAttemptsMatch = text.match(/^max attempts ([0-9][0-9,.]*)$/)
  if (maxAttemptsMatch) {
    return `最大尝试次数：${maxAttemptsMatch[1]}`
  }

  const payloadSpoolMatch = text.match(/^(.+) payload spool$/)
  if (payloadSpoolMatch) {
    return `payload spool：${payloadSpoolMatch[1]}`
  }

  const quarantinedMatch = text.match(/^(.+) quarantined$/)
  if (quarantinedMatch) {
    return `quarantine：${quarantinedMatch[1]}`
  }

  const allSectionsMatch = text.match(/^all ([0-9][0-9,.]*) sections$/)
  if (allSectionsMatch) {
    return `全部 ${allSectionsMatch[1]} 个区域`
  }

  const sectionCountMatch = text.match(/^(.+) \(([0-9][0-9,.]*) sections\)$/)
  if (sectionCountMatch) {
    return `${sectionCountMatch[1]}（${sectionCountMatch[2]} 个区域）`
  }

  const remoteContractMatch = text.match(/^Remote contract active via (.+) \(([0-9][0-9,.]*) sections\)\.$/)
  if (remoteContractMatch) {
    return `远端契约已启用：${remoteContractMatch[1]}（${remoteContractMatch[2]} 个区域）。`
  }

  const remoteContractDriftMatch = text.match(/^Remote contract active via (.+) \(([0-9][0-9,.]*) sections\), but \/api\/v1\/status reports compat hash drift\.$/)
  if (remoteContractDriftMatch) {
    return `远端契约已启用：${remoteContractDriftMatch[1]}（${remoteContractDriftMatch[2]} 个区域），但 /api/v1/status 报告 compat hash 不一致。`
  }

  return null
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

export function buildLocaleCookieWrites(locale, path = '/') {
  const normalizedLocale = normalizeDashboardLocale(locale) ?? DEFAULT_LOCALE
  const normalizedPath = normalizeLocaleCookiePath(path)
  const writes = [
    `${LOCALE_COOKIE_NAME}=${normalizedLocale}; Path=${normalizedPath}; Max-Age=31536000; SameSite=Lax`,
  ]

  if (normalizedPath !== '/') {
    writes.push(`${LOCALE_COOKIE_NAME}=; Path=/; Max-Age=0; SameSite=Lax`)
  }

  for (const legacyCookieName of LEGACY_LOCALE_COOKIE_NAMES) {
    writes.push(`${legacyCookieName}=; Path=/; Max-Age=0; SameSite=Lax`)
  }

  return writes
}

export function writeLocaleCookie(doc, locale, path = '/') {
  if (!doc) {
    return
  }

  for (const cookieWrite of buildLocaleCookieWrites(locale, path)) {
    doc.cookie = cookieWrite
  }
}

export function t(key, locale = currentLocale) {
  return getMessages(locale)[key] ?? EN_MESSAGES[key] ?? key
}

export function translateText(text, locale = currentLocale) {
  if (typeof text !== 'string' || text.length === 0 || locale === 'en') {
    return text
  }

  if (text.includes(' . ')) {
    return text.split(' . ').map((part) => translateText(part, locale)).join(isChineseLocale(locale) ? ' · ' : ' . ')
  }

  const directKey = TEXT_TO_KEY[text]
  if (directKey) {
    return t(directKey, locale)
  }

  const dynamicText = translateDynamicText(text, locale)
  if (dynamicText) {
    return dynamicText
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

  return text
}

export function getDurationUnit(locale, unit, value) {
  const normalizedLocale = normalizeDashboardLocale(locale) ?? DEFAULT_LOCALE
  const pluralKey = value === 1 ? `${unit}.one` : `${unit}.other`
  return t(`unit.${pluralKey}`, normalizedLocale)
}
