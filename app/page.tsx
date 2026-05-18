export default function Home() {
  return (
    <main>
      <section className="hero">
        <h1>Printshop</h1>
        <p>3D-printed goods, made to order. Webshop launching soon.</p>
        <p className="muted">Staging placeholder · build {process.env.NEXT_PUBLIC_BUILD_SHA ?? "dev"}</p>
      </section>
    </main>
  );
}
