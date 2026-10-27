
#include <WiFi.h>
#include <WebSocketsClient.h>
#include <ArduinoJson.h>

// ================= WIFI =================

const char* WIFI_SSID = "Redmi Note 12 Pro 5G";
const char* WIFI_PASSWORD = "Ananya@2006";

// Enter your laptop's IPv4 address.
// Example: 192.168.1.10
const char* SERVER_IP = "10.27.62.34";

const uint16_t SERVER_PORT = 8080;
const char* WS_PATH = "/remote";

// ================= BUTTON PINS =================

const int buttonPins[7] = {
  4,    // HOME
  5,    // UP
  13,   // DOWN
  14,   // LEFT
  27,   // RIGHT
  32,   // OK
  33    // BACK
};

// ================= LED PINS =================

const int ledPins[7] = {
  18,   // HOME LED
  19,   // UP LED
  21,   // DOWN LED
  22,   // LEFT LED
  23,   // RIGHT LED
  25,   // OK LED
  26    // BACK LED
};


// Passive buzzer
const int BUZZER_PIN = 2;  // D2 (GPIO 2)

// ================= BUTTON NAMES =================

const char* buttonNames[7] = {
  "home",
  "up",
  "down",
  "left",
  "right",
  "ok",
  "back"
};

// ================= VARIABLES =================

WebSocketsClient webSocket;

bool connected = false;
bool guidedMode = true;

bool menuOpen = false;
int selectedTask = 0;

String taskIds[20];
String taskNames[20];

int taskSteps[20][50];
int taskStepCount[20];

int taskCount = 0;

int activeTask = -1;
int currentStep = 0;

unsigned long lastButtonTime[7] = {0};

const unsigned long debounceDelay = 250;


// ================= SETTINGS FROM TV =================

int ledBrightness = 100;      // 0-100, from Picture > Brightness
int buzzerVolume = 7;         // 0-10, from Sound > Volume
bool buzzerEnabled = true;    // false when Sound Mode is Mute or Audio Output is TV Speaker
bool clickSounds = true;      // short blip on correct presses (Sound Mode: Standard)

int litLED = -1;              // LED currently lit, -1 = none
unsigned long previewUntil = 0;

unsigned long connectedSince = 0;
unsigned long lastNetReport = 0;

// Buzzer gets its own LEDC channel so changing its pitch never disturbs the LED channels 0-6.
const int BUZZER_CHANNEL = 14;


// ================= LED CONTROL =================
// LEDs use PWM so Picture > Brightness can dim them (8-bit duty: 0-255).

int ledDuty() {
  // Squared so the steps look even to the eye; never fully off.
  return max(ledBrightness * ledBrightness * 255 / 10000, 3);
}

void allLEDsOff() {
  for (int i = 0; i < 7; i++) {
    ledcWrite(ledPins[i], 0);
  }
  litLED = -1;
}

void showLED(int buttonIndex) {
  allLEDsOff();

  if (buttonIndex >= 0 && buttonIndex < 7) {
    ledcWrite(ledPins[buttonIndex], ledDuty());
    litLED = buttonIndex;
  }
}

// Light every LED briefly at the new brightness, then restore.
void previewBrightness() {
  for (int i = 0; i < 7; i++) {
    ledcWrite(ledPins[i], ledDuty());
  }
  previewUntil = millis() + 800;
}

void restoreLEDs() {
  int keep = litLED;
  if (keep >= 0) showLED(keep);
  else allLEDsOff();
}


int buttonIndexFromName(String name) {
  name.toLowerCase();

  for (int i = 0; i < 7; i++) {
    if (name == buttonNames[i]) {
      return i;
    }
  }

  return -1;
}

// ================= WEBSOCKET SEND =================

void sendAction(String action) {
  if (!connected) {
    Serial.println("WebSocket not connected");
    return;
  }

  StaticJsonDocument<100> doc;

  doc["action"] = action;

  String message;
  serializeJson(doc, message);

  webSocket.sendTXT(message);

  Serial.print("Sent action: ");
  Serial.println(action);
}

void sendEvent(String eventName) {
  if (!connected) return;

  StaticJsonDocument<150> doc;

  doc["event"] = eventName;

  String message;
  serializeJson(doc, message);

  webSocket.sendTXT(message);
}

// ================= TASK MENU =================


void openTaskMenu() {

  if (!connected) {
    Serial.println("Website not connected");
    return;
  }

  if (taskCount == 0) {
    Serial.println("No tasks available");
    return;
  }

  menuOpen = true;

  // Start at the first task every time
  selectedTask = 0;

  Serial.println();
  Serial.println("===== TASK MENU =====");

  for (int i = 0; i < taskCount; i++) {

    Serial.print(i);
    Serial.print(" : ");
    Serial.println(taskNames[i]);

  }

  printSelectedTask();

  StaticJsonDocument<150> doc;

  doc["event"] = "menu";
  doc["selected"] = selectedTask;

  String message;

  serializeJson(doc, message);

  webSocket.sendTXT(message);

  Serial.println("Task menu opened");

}


void printSelectedTask() {
  if (taskCount == 0) {
    Serial.println("No tasks received");
    return;
  }

  Serial.print("Selected task: ");
  Serial.println(taskNames[selectedTask]);
}

// ================= TASK START =================


void startSelectedTask() {

  if (taskCount == 0) {
    Serial.println("No tasks available");
    return;
  }

  if (!connected) {
    Serial.println("Website not connected");
    return;
  }

  StaticJsonDocument<1024> doc;

  doc["event"] = "task_start";
  doc["task"] = taskIds[selectedTask];

  // Send the original task steps for now.
  // The website will calculate the correct steps.
  JsonArray steps = doc.createNestedArray("steps");

  for (int i = 0; i < taskStepCount[selectedTask]; i++) {
    steps.add(buttonNames[
      taskSteps[selectedTask][i]
    ]);
  }

  String message;
  serializeJson(doc, message);

  webSocket.sendTXT(message);

  Serial.print("Starting task: ");
  Serial.println(taskNames[selectedTask]);
}


// ================= TASK GUIDANCE =================

void updateGuidedLED() {
  if (!guidedMode || activeTask < 0) {
    allLEDsOff();
    return;
  }

  if (currentStep >= taskStepCount[activeTask]) {
    allLEDsOff();
    return;
  }

  int buttonIndex = taskSteps[activeTask][currentStep];

  showLED(buttonIndex);

  if (connected) {
    StaticJsonDocument<100> doc;

    doc["event"] = "led";
    doc["button"] = buttonNames[buttonIndex];

    String message;
    serializeJson(doc, message);

    webSocket.sendTXT(message);
  }
}

void handleTaskButton(int buttonIndex) {
  if (activeTask < 0) return;

  if (currentStep >= taskStepCount[activeTask]) return;

  int expectedButton = taskSteps[activeTask][currentStep];

  if (buttonIndex == expectedButton) {

    Serial.println("Correct button!");
    correctBeep();


    // Send the actual TV action
    sendAction(buttonNames[buttonIndex]);

    currentStep++;

    if (currentStep >= taskStepCount[activeTask]) {

      Serial.println("Task sequence completed");

      allLEDsOff();

      // Website checks the actual TV state
      // and completes the task.
      sendEvent("task_complete");

      activeTask = -1;
      currentStep = 0;

    } else {

      updateGuidedLED();

    }

  } else {

    Serial.println("Wrong button!");

    // Keep the expected LED glowing
    showLED(expectedButton);

    // Sound the passive buzzer
    wrongButtonBeep();

    // Inform the website
    if (connected) {

        StaticJsonDocument<150> doc;

        doc["event"] = "wrong";
        doc["pressed"] = buttonNames[buttonIndex];
        doc["expected"] = buttonNames[expectedButton];

        String message;

        serializeJson(doc, message);

        webSocket.sendTXT(message);
    }
}
}

// ================= TASK LIST RECEIVED =================

void receiveTasks(JsonArray tasks) {

  taskCount = 0;
  selectedTask = 0;

  for (JsonObject task : tasks) {

    if (taskCount >= 20) break;

    taskIds[taskCount] =
      task["id"].as<String>();

    taskNames[taskCount] =
      task["name"].as<String>();

    JsonArray steps = task["steps"];

    taskStepCount[taskCount] = 0;

    for (JsonVariant step : steps) {

      if (taskStepCount[taskCount] >= 50) break;

      String stepName = step.as<String>();

      int index = buttonIndexFromName(stepName);

      if (index >= 0) {

        taskSteps[taskCount][taskStepCount[taskCount]] =
          index;

        taskStepCount[taskCount]++;
      }
    }

    taskCount++;
  }

  Serial.println();
  Serial.println("===== TASKS RECEIVED =====");

  for (int i = 0; i < taskCount; i++) {

    Serial.print(i);
    Serial.print(" : ");
    Serial.println(taskNames[i]);
  }

  Serial.println("=========================");
}

// ================= WEBSOCKET EVENTS =================

void webSocketEvent(
  WStype_t type,
  uint8_t* payload,
  size_t length
) {

  switch (type) {

    case WStype_CONNECTED:

      connected = true;
      connectedSince = millis();
      sendNetworkReport();


      Serial.println("Connected to LitPath website");

      allLEDsOff();

      break;

    case WStype_DISCONNECTED:

      connected = false;

      activeTask = -1;

      allLEDsOff();

      Serial.println("Disconnected from website");

      break;

    case WStype_TEXT: {

      StaticJsonDocument<4096> doc;

      DeserializationError error =
        deserializeJson(doc, payload, length);

      if (error) {
        Serial.println("Invalid JSON received");
        return;
      }

      String eventName = doc["event"] | "";

      // Receive task list
      if (eventName == "tasks") {

        JsonArray tasks = doc["tasks"];

        receiveTasks(tasks);

      }

      // Website starts selected task
      
      else if (eventName == "task_start") {

        String taskId = doc["task"] | "";

        activeTask = -1;

        for (int i = 0; i < taskCount; i++) {

          if (taskIds[i] == taskId) {
            activeTask = i;
            break;
          }
        }

        if (activeTask >= 0) {

          // Reset the task execution
          currentStep = 0;

          // Use dynamically generated steps
          JsonArray steps = doc["steps"];

          if (!steps.isNull()) {

            taskStepCount[activeTask] = 0;

            for (JsonVariant step : steps) {

              if (taskStepCount[activeTask] >= 50) {
                break;
              }

              String stepName = step.as<String>();

              int index = buttonIndexFromName(stepName);

              if (index >= 0) {

                taskSteps[activeTask]
                        [taskStepCount[activeTask]] = index;

                taskStepCount[activeTask]++;
              }
            }
          }

          menuOpen = false;

          Serial.print("Task started: ");
          Serial.println(taskNames[activeTask]);

          updateGuidedLED();

        } else {

          Serial.println("Unknown task received");
        }
      }


      // Website changes guided mode
      else if (eventName == "mode") {

        guidedMode = doc["guided"] | true;

        if (!guidedMode) {
          allLEDsOff();
        } else {
          updateGuidedLED();
        }
      }

            // TV settings: LED brightness, buzzer volume and sound mode
      else if (eventName == "remote_settings") {

        int newBrightness = constrain((int)(doc["brightness"] | ledBrightness), 0, 100);

        buzzerVolume = constrain((int)(doc["volume"] | buzzerVolume), 0, 10);
        buzzerEnabled = doc["buzzer"] | true;
        clickSounds = doc["clicks"] | true;

        if (newBrightness != ledBrightness) {
          ledBrightness = newBrightness;
          previewBrightness();
        }

        if (doc["test"] | false) {
          beep(1500, 120);
        }

        Serial.printf("Settings: LED %d%%, volume %d, buzzer %s\n",
          ledBrightness, buzzerVolume, buzzerEnabled ? "on" : "off");
      }

      // Network Test: reply immediately so the TV can time the round trip
      else if (eventName == "net_ping") {

        StaticJsonDocument<64> reply;

        reply["event"] = "net_pong";
        reply["id"] = doc["id"];

        String message;
        serializeJson(reply, message);

        webSocket.sendTXT(message);
      }



      // Website can also send an action
      else if (doc.containsKey("action")) {

        String action = doc["action"].as<String>();

        int index = buttonIndexFromName(action);

        if (index >= 0) {

          sendAction(action);
        }
      }

      break;
    }

    default:
      break;
  }
}

// ================= BUTTON HANDLING =================

void handleButtonPress(int buttonIndex) {

  unsigned long now = millis();

  if (now - lastButtonTime[buttonIndex] < debounceDelay) {
    return;
  }

  lastButtonTime[buttonIndex] = now;

  Serial.print("Button pressed: ");
  Serial.println(buttonNames[buttonIndex]);

  // Task selection menu
  if (menuOpen) {

    if (buttonIndex == 1) {  // UP

      selectedTask--;

      if (selectedTask < 0) {
        selectedTask = taskCount - 1;
      }

      printSelectedTask();

      sendAction("up");

    }

    else if (buttonIndex == 2) {  // DOWN

      selectedTask++;

      if (selectedTask >= taskCount) {
        selectedTask = 0;
      }

      printSelectedTask();

      sendAction("down");

    }

    else if (buttonIndex == 5) {  // OK

      menuOpen = false;

      startSelectedTask();

    }

    else if (buttonIndex == 6 || buttonIndex == 0) {

      menuOpen = false;

      sendAction(buttonNames[buttonIndex]);

    }

    return;
  }

  // HOME opens task selection
  if (buttonIndex == 0 && activeTask < 0) {

    openTaskMenu();

    return;
  }

  // Task guidance
  if (activeTask >= 0) {

    handleTaskButton(buttonIndex);

    return;
  }

  // Normal remote actions
  correctBeep();
  sendAction(buttonNames[buttonIndex]);
}

// ================= BUZZER =================
// Volume = PWM duty. ledcWriteTone() switches the channel to 10-bit, so 512 = 50% = loudest.

void beep(int freq, int ms) {
  if (!buzzerEnabled || buzzerVolume == 0) return;

  ledcWriteTone(BUZZER_PIN, freq);
  ledcWrite(BUZZER_PIN, buzzerVolume * buzzerVolume * 512 / 100);
  delay(ms);
  ledcWrite(BUZZER_PIN, 0);
}

void buzzerOff() {
  ledcWrite(BUZZER_PIN, 0);
}

void wrongButtonBeep() {
  beep(2000, 150);
}

void correctBeep() {
  if (clickSounds) beep(3000, 40);
}

// ================= NETWORK REPORT =================
// Tells the TV the real Wi-Fi name, signal strength and IP.

void sendNetworkReport() {
  if (!connected) return;

  StaticJsonDocument<200> doc;

  doc["event"] = "net";
  doc["ssid"] = WiFi.SSID();
  doc["rssi"] = WiFi.RSSI();
  doc["ip"] = WiFi.localIP().toString();
  doc["uptime"] = (millis() - connectedSince) / 1000;

  String message;
  serializeJson(doc, message);

  webSocket.sendTXT(message);
}


// ================= SETUP =================

void setup() {

  Serial.begin(115200);

  Serial.println();
  Serial.println("===== LITPATH REMOTE =====");

  // Configure buttons
  for (int i = 0; i < 7; i++) {

    pinMode(buttonPins[i], INPUT_PULLUP);
  }

  // Configure LEDs as PWM (channels 0-6) so they can be dimmed
  for (int i = 0; i < 7; i++) {
    ledcAttachChannel(ledPins[i], 5000, 8, i);
    ledcWrite(ledPins[i], 0);
  }

  // Configure passive buzzer on its own channel, start OFF
  ledcAttachChannel(BUZZER_PIN, 2000, 10, BUZZER_CHANNEL);
  buzzerOff();

  // Connect Wi-Fi
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  Serial.print("Connecting to Wi-Fi");

  while (WiFi.status() != WL_CONNECTED) {

    delay(500);

    Serial.print(".");
  }

  Serial.println();

  Serial.println("Wi-Fi connected");

  Serial.print("ESP32 IP: ");
  Serial.println(WiFi.localIP());

  // Connect to LitPath WebSocket
  webSocket.begin(
    SERVER_IP,
    SERVER_PORT,
    WS_PATH
  );

  webSocket.onEvent(webSocketEvent);

  webSocket.setReconnectInterval(2000);

  webSocket.enableHeartbeat(
    15000,
    3000,
    2
  );

  Serial.println("Waiting for LitPath website...");
}

// ================= LOOP =================

void loop() {

  webSocket.loop();

    if (millis() - lastNetReport > 3000) {
    lastNetReport = millis();
    sendNetworkReport();
  }

  if (previewUntil && millis() > previewUntil) {
    previewUntil = 0;
    restoreLEDs();
  }


  for (int i = 0; i < 7; i++) {

    if (digitalRead(buttonPins[i]) == LOW) {

      handleButtonPress(i);

      // Wait for release to avoid repeated presses
      while (digitalRead(buttonPins[i]) == LOW) {

        webSocket.loop();

        delay(10);
      }
    }
  }
}
