#ifndef LOGGABLE_H
#define LOGGABLE_H

#include <Arduino.h>

class Loggable {
protected:
    Stream* logOutput;

    Loggable(Stream* output = nullptr) : logOutput(output) {}

    template<typename T>
    void log(T value) {
        if (logOutput) logOutput->println(value);
    }

    template<typename T, typename K>
    void log(T msg, K value) {
        if (logOutput) {
            logOutput->print(msg);
            logOutput->println(value);
        }
    }
};

#endif