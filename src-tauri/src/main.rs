// 윈도우에서 실행할 때 검은 명령 창이 같이 뜨지 않게
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    potato_editor_lib::run()
}
