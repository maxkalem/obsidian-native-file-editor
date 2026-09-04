// Verilog: module, parameters, always blocks, case.
`timescale 1ns / 1ps

module autosave_timer #(
    parameter integer DELAY = 1000
) (
    input  wire clk,
    input  wire rst_n,
    input  wire change,
    output reg  save
);
    reg [15:0] count;

    always @(posedge clk or negedge rst_n) begin
        if (!rst_n) begin
            count <= 16'd0;
            save  <= 1'b0;
        end else if (change) begin
            count <= 16'd0;
            save  <= 1'b0;
        end else if (count == DELAY - 1) begin
            save  <= 1'b1;
        end else begin
            count <= count + 16'd1;
        end
    end
endmodule
