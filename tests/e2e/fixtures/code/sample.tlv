\m4_TLV_version 1d: tl-x.org
\SV
   // TL-Verilog: a counter that fires after DELAY cycles without changes.
   module autosave_timer(input logic clk, input logic reset, input logic change, output logic save);
\TLV
   $reset = *reset;
   $change = *change;
   $count[15:0] = $reset || $change ? 16'd0 : >>1$count + 16'd1;
   $save = $count == 16'd999;
   *save = $save;
\SV
   endmodule
