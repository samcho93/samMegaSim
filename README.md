# samMegaSim

**웹 기반 ATmega 마이크로컨트롤러 회로도 작성 · 시뮬레이터** (Proteus 스타일)

👉 **https://samcho93.github.io/samMegaSim/**

KiCad 스타일의 회로도 시트에 ATmega MCU와 각종 전자 부품을 회로 기호로 배치하고, C 코드를 WinAVR(avr-gcc)로 컴파일하여 브라우저에서 바로 시뮬레이션합니다.

## 주요 기능

- **KiCad 스타일 회로도 편집기** — A4/A3 시트, 도면 테두리/표제란, 그리드 스냅, 핀 끝 클릭으로 와이어 시작, 러버밴드(부품 이동 시 와이어 추종), 정션 자동 표시, 네트 라벨, 전원 심볼(VCC/+5V/+3.3V/+12V/GND), 회전·반전, 실행 취소/다시 실행, 복사/붙여넣기, SVG/PNG 내보내기
- **ATmega MCU** — 회로도 심볼 형태(핀 번호 + 기능명)로 자동 생성
  - ATmega8, ATmega16, ATmega32, ATmega128, ATmega168, ATmega328P, ATmega644P, ATmega1284P, ATmega2560
  - GPIO, 외부/핀 변화 인터럽트, Timer0~5 (PWM 포함, 구형 TCCRn 레지스터 매핑), USART, ADC(자유 실행 포함), SPI(비트 단위 파형), TWI(I2C), EEPROM
- **C 코드 에디터** (CodeMirror) — 여러 .c/.h 파일, 오류 줄 표시, 오류 클릭 시 해당 줄 이동
- **WinAVR 컴파일러 플러그인** — 로컬 브리지(`bridge/samMegaSim-bridge.cmd`)가 avr-gcc를 실행. WinAVR가 없으면 브리지가 SourceForge에서 내려받아 설치
- **회로 시뮬레이션** — 이벤트 구동 MNA 해석기(저항 분압, LED 전류/밝기, 트랜지스터, MOSFET, 다이오드, 커패시터 과도응답, 풀업 등)
- **부품** — 저항, 커패시터, 인덕터, 가변저항, LDR, 크리스탈, 다이오드, 제너, LED(색상별), RGB LED, NPN/PNP, N/P-MOSFET, 푸시버튼, 토글/SPDT/DIP 스위치, 4x4 키패드, 릴레이, 부저(소리), DC 모터, 서보, LM35, HC-SR04, 7세그먼트(1/4자리), LED 바, 8x8 도트 매트릭스, HD44780 LCD(16x2/20x4), 74HC595, 74HC138, 논리 게이트, 24Cxx EEPROM, DS1307 RTC, PCF8574, I2C LCD
- **가상 계측기** — 4채널 오실로스코프(트리거/측정/커서), 8채널 로직 분석기, UART 가상 터미널(비트 단위 디코딩, 보레이트 불일치 재현), DC 전압계/전류계, 전압 프로브, Logic State/Probe
- **예제 프로젝트** (사전 빌드된 HEX 포함)
  - ATmega328P: Blink, 외부 인터럽트, PWM, ADC+UART, LCD, 7세그먼트, 서보, 74HC595(SPI), DC 모터, I2C LCD + DS1307
  - ATmega128: LED 시프트 + UART 에코, 외부 인터럽트 카운터(INT4/5), 4자리 FND 스톱워치(Timer0 CTC), ADC + LCD(가변저항/LM35), PWM + LED 레벨미터(ADC 자유 실행), 부저 멜로디(Timer1 CTC), 4x4 키패드 스캔, 서보(Timer3 PWM), USART1 명령 LED 제어

## 화면 구성

| 왼쪽 | 가운데 | 오른쪽 |
| --- | --- | --- |
| 부품 라이브러리 / 프로젝트(BOM) | 회로도 시트 · C 코드 탭 | 시뮬레이션 상태 · 오실로스코프 · 터미널 · 로직 분석기 · MCU 레지스터 · 빌드 출력 |

## WinAVR 컴파일러 연결

브라우저는 PC의 프로그램을 직접 실행할 수 없으므로 작은 로컬 브리지가 필요합니다.

1. 사이트의 **도움말 → WinAVR 컴파일러 설정**에서 `samMegaSim-bridge.cmd`를 내려받아 실행합니다.
   (PowerShell 기반, 127.0.0.1:8787 에서만 대기, 허용된 출처에서 온 요청만 처리)
2. WinAVR가 설치되어 있으면 자동으로 찾습니다 (`C:\WinAVR-*`, PATH 등).
   없으면 설정 창의 **WinAVR 자동 다운로드 & 설치** 버튼으로 WinAVR-20100110을 설치합니다 (관리자 권한 확인 창 표시).
3. 코드 탭에서 **빌드(F7)** → 결과 HEX가 대상 MCU에 자동으로 로드됩니다.

Linux/macOS는 `bridge/sms_bridge.py`(avr-gcc 필요)를 사용할 수 있습니다.

## 단축키

| 키 | 동작 |
| --- | --- |
| W / L / P / G | 와이어 / 네트 라벨 / VCC / GND |
| R / X | 회전 / 반전 |
| E, 더블클릭 | 속성 편집 |
| Del | 삭제 |
| Ctrl+Z / Ctrl+Y | 실행 취소 / 다시 실행 |
| Ctrl+C / X / V / D | 복사 / 잘라내기 / 붙여넣기 / 복제 |
| Home, F | 전체 보기 |
| F5 / F6 / Shift+F5 / F10 | 실행 / 일시정지 / 정지 / 1ms 진행 |
| F7 | 빌드 |

## 로컬 실행 / 개발

```bash
python tools/serve.py 8080          # http://localhost:8080
node tools/build-examples.mjs       # 예제 컴파일 + 헤드리스 시뮬레이션 테스트 (WinAVR 필요)
node tools/check-symbols.mjs        # 모든 심볼 핀이 그리드 위에 있는지 검사
```

빌드 도구 없이 순수 ES 모듈로 동작합니다.

## 라이선스 / 사용 라이브러리

- AVR CPU 코어: [avr8js](https://github.com/wokwi/avr8js) (MIT, `vendor/avr8js.mjs`로 번들)
- 코드 에디터: [CodeMirror 5](https://codemirror.net/5/) (MIT, cdnjs)
- 컴파일러: [WinAVR](https://sourceforge.net/projects/winavr/) 20100110 (사용자 PC에 설치)
