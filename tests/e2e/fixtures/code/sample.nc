// nesC: TinyOS module with interfaces and events.
#include "Timer.h"

module BlinkC @safe() {
  uses interface Timer<TMilli> as Timer0;
  uses interface Leds;
  uses interface Boot;
}
implementation {
  uint16_t counter = 0;

  event void Boot.booted() {
    call Timer0.startPeriodic(250);
  }

  event void Timer0.fired() {
    counter++;               /* wraps at 65535 */
    call Leds.set(counter & 0x07);
  }
}
