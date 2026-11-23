// 감자 편집기 앱 껍데기: 편집기 화면(dist/app)을 띄우고, 파일 저장·팩 받기·업데이트에 필요한 기능만 켜요
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_upload::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_http::init())   // 이 PC 안의 IOPaint에 그림을 보낼 때만 써요
        .run(tauri::generate_context!())
        .expect("감자 편집기를 시작하지 못했어요");
}
