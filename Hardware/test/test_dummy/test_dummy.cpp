#include <Arduino.h>
#include <unity.h>
void test_dummy() { TEST_ASSERT_TRUE(true); }
void setup() {
  Serial0.begin(115200); delay(1000);
  UNITY_BEGIN();
  RUN_TEST(test_dummy);
  UNITY_END();
}
void loop() {}
