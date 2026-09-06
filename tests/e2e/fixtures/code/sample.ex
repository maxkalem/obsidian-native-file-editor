defmodule Notes.Vault do
  @moduledoc "Reads notes from a folder."
  @default_ext ".md"

  # Return every note path under `root`.
  def list(root, ext \\ @default_ext) do
    root
    |> File.ls!()
    |> Enum.filter(&String.ends_with?(&1, ext))
    |> Enum.map(fn name -> Path.join(root, name) end)
  end

  def count(root), do: root |> list() |> length()

  defp valid?(%{size: size}) when size > 0, do: true
  defp valid?(_), do: false
end
