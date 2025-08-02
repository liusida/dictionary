#include "Arduino.h"
#include <unity.h>
#include "WiFi.h"
#include "Audio.h"
#include "SD.h"
#include "FS.h"

#include "pins.h"
// #define Serial Serial0

Audio audio;

String ssid =     "StarLab_2.4G";
String password = "1234567891";

void test_main() {
    pinMode(PIN_SOUND_SD, OUTPUT);
    // digitalWrite(PIN_SOUND_SD, LOW); // mute
    digitalWrite(PIN_SOUND_SD, HIGH); // unmute( >1.4V = Left channel )

    Serial.println("test_main");
    Serial.println("disconnect");
    WiFi.disconnect();
    Serial.println("mode");
    WiFi.mode(WIFI_STA);
    Serial.println("begin");
    WiFi.begin(ssid.c_str(), password.c_str());
    Serial.println("wait");
    while (WiFi.status() != WL_CONNECTED) {
        Serial.println(WiFi.status());
        delay(1500);
    }
    Serial.println("audio.setPinout");
    audio.setPinout(PIN_SOUND_BCLK, PIN_SOUND_LRC, PIN_SOUND_DIN);
    Serial.println("setVolume");
    audio.setVolume(21); // default 0...21
    audio.forceMono(true);  // <--- ADD THIS LINE

//  *** radio streams ***
    Serial.println("https://dict.liusida.com/audio/explanation/apple.mp3");
    audio.connecttohost("https://dict.liusida.com/audio/explanation/apple.mp3");

}

void setup() {
    Serial.begin(115200);
    Serial.println("Serial begin.");
    // UNITY_BEGIN();
    // RUN_TEST(test_main);
    // UNITY_END();
    test_main();

}

void loop(){
    audio.loop();
    if (!audio.isRunning()) {
        Serial.println("play again");
        audio.connecttohost("https://dict.liusida.com/audio/explanation/apple.mp3");

    }
    vTaskDelay(1);
}

// optional
void audio_info(const char *info){
    Serial.print("info        "); Serial.println(info);
}
void audio_id3data(const char *info){  //id3 metadata
    Serial.print("id3data     ");Serial.println(info);
}
void audio_eof_mp3(const char *info){  //end of file
    Serial.print("eof_mp3     ");Serial.println(info);
}
void audio_showstation(const char *info){
    Serial.print("station     ");Serial.println(info);
}
void audio_showstreamtitle(const char *info){
    Serial.print("streamtitle ");Serial.println(info);
}
void audio_bitrate(const char *info){
    Serial.print("bitrate     ");Serial.println(info);
}
void audio_commercial(const char *info){  //duration in sec
    Serial.print("commercial  ");Serial.println(info);
}
void audio_icyurl(const char *info){  //homepage
    Serial.print("icyurl      ");Serial.println(info);
}
void audio_lasthost(const char *info){  //stream URL played
    Serial.print("lasthost    ");Serial.println(info);
}
void audio_eof_speech(const char *info){
    Serial.print("eof_speech  ");Serial.println(info);
}
