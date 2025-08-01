#ifndef SHARED_GLOBALS_H
#define SHARED_GLOBALS_H

enum AudioType {
    AUDIO_NONE = 0,
    AUDIO_WORD = 1,
    AUDIO_EXPLANATION = 2,
    AUDIO_SAMPLE = 3
};

extern volatile bool wordReady;
extern char currentWord[256];
extern char wordToLookup[256];
extern volatile AudioType currentPlayingAudioType;

void oled_print(const char* msg);
void beep();
void print_heap_size();
#endif
