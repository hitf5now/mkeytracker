import { PlayerSearch } from "@/components/player-search";

export default function CharacterNotFound() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="mb-8">
        <PlayerSearch />
      </div>
      <div className="py-12 text-center">
        <h1 className="text-2xl font-bold">Character Not Found</h1>
        <p className="mt-2 text-muted-foreground">
          This character hasn&apos;t been registered yet or hasn&apos;t been
          part of any tracked run. Try searching for another player above.
        </p>
      </div>
    </div>
  );
}
