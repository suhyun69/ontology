import { Card, H1, Navbar } from "@blueprintjs/core";

export function App() {
  return (
    <>
      <Navbar>
        <Navbar.Group>
          <Navbar.Heading>Data Platform</Navbar.Heading>
        </Navbar.Group>
      </Navbar>
      <main style={{ padding: 20 }}>
        <Card>
          <H1>Data Platform</H1>
          <p>The shell is up. Nothing is wired to the ontology API yet.</p>
        </Card>
      </main>
    </>
  );
}
