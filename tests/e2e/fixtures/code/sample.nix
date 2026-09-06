# A shell with the tools this project needs
{ pkgs ? import <nixpkgs> {} }:

let
  node = pkgs.nodejs_22;
  version = "0.1.0";
in
pkgs.mkShell {
  packages = [ node pkgs.git ];
  shellHook = ''
    echo "native-file-editor ${version}"
    export NODE_OPTIONS="--max-old-space-size=4096"
  '';
  meta = with pkgs.lib; {
    description = "dev shell";
    license = licenses.gpl3Only;
  };
}
