export interface SaveRepository { save(value: SaveInput): Promise<SaveInput>; }
export interface SaveInput { name: string; }
export async function save(input: SaveInput, repository: SaveRepository): Promise<SaveInput> {
  if (!input.name.trim()) throw new Error("name is required");
  return repository.save({ ...input, name: input.name.trim() });
}