#include "manage_sound.h"

ManageSound::ManageSound(Stream *logOutput)
    : Loggable(logOutput), _sampleRate(44100), _i2sPort(I2S_NUM_0) {}

void ManageSound::init(int bclkPin, int lrcPin, int dinPin, int sdPin, int sampleRate) {
    if (sdPin != -1) {
        pinMode(PIN_SOUND_SD, OUTPUT);
        // digitalWrite(PIN_SOUND_SD, LOW); // mute
        digitalWrite(PIN_SOUND_SD, HIGH); // unmute( >1.4V = Left channel )
    }
    _sampleRate = sampleRate;
    i2s_config_t i2s_config = {
        .mode = (i2s_mode_t)(I2S_MODE_MASTER | I2S_MODE_TX),
        .sample_rate = (uint32_t)_sampleRate,
        .bits_per_sample = I2S_BITS_PER_SAMPLE_16BIT,
        .channel_format = I2S_CHANNEL_FMT_ONLY_LEFT,
        .communication_format = I2S_COMM_FORMAT_STAND_I2S,
        .intr_alloc_flags = 0,
        .dma_buf_count = 8,
        .dma_buf_len = 64,
        .use_apll = false,
        .tx_desc_auto_clear = true,
        .fixed_mclk = 0
    };
    i2s_pin_config_t pin_config = {
        .bck_io_num = bclkPin,
        .ws_io_num = lrcPin,
        .data_out_num = dinPin,
        .data_in_num = I2S_PIN_NO_CHANGE
    };
    esp_err_t err = i2s_driver_install(_i2sPort, &i2s_config, 0, NULL);
    if (err != ESP_OK) {
        log("I2S driver install failed: " + String(err));
    }
    i2s_set_pin(_i2sPort, &pin_config);
    log("I2S initialized");
    Device::init();
}

void ManageSound::playTestTone(float frequency, int durationMs, int loudness) {
    const int chunkSize = 256; // or 512, keep it small!
    int16_t buffer[chunkSize];
    size_t bytesWritten = 0;

    int totalSamples = (int)((uint32_t)_sampleRate * durationMs / 1000);
    int samplesSent = 0;

    while (samplesSent < totalSamples) {
        int toWrite = min(chunkSize, totalSamples - samplesSent);
        for (int i = 0; i < toWrite; ++i) {
            int t = samplesSent + i;
            buffer[i] = loudness  * sinf(2 * PI * frequency * t / _sampleRate);
        }
        i2s_write(_i2sPort, (const char*)buffer, toWrite * sizeof(int16_t), &bytesWritten, portMAX_DELAY);
        samplesSent += toWrite;
    }
    // log("Played test tone: " + String(frequency) + " Hz, " + String(durationMs) + " ms");
}


void ManageSound::stop() {
    i2s_zero_dma_buffer(_i2sPort);
    log("I2S stopped");
}
