#ifndef SHARED_GLOBALS_H
#define SHARED_GLOBALS_H

extern volatile bool wordReady;
extern char currentWord[256];
extern char wordToLookup[256];

void oled_print(const char* msg);

#endif
