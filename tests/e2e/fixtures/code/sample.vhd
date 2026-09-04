-- VHDL: entity, architecture, process, signals.
library ieee;
use ieee.std_logic_1164.all;
use ieee.numeric_std.all;

entity autosave_timer is
  generic (DELAY : natural := 1000);
  port (
    clk    : in  std_logic;
    rst_n  : in  std_logic;
    change : in  std_logic;
    save   : out std_logic
  );
end entity;

architecture rtl of autosave_timer is
  signal count : unsigned(15 downto 0) := (others => '0');
begin
  process (clk, rst_n)
  begin
    if rst_n = '0' then
      count <= (others => '0');
      save  <= '0';
    elsif rising_edge(clk) then
      if change = '1' then
        count <= (others => '0');
        save  <= '0';
      elsif count = to_unsigned(DELAY - 1, 16) then
        save <= '1';
      else
        count <= count + 1;
      end if;
    end if;
  end process;
end architecture;
