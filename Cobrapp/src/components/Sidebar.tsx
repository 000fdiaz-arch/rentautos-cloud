interface SidebarProps {
  onResetDemo: () => void;
}

function Sidebar({ onResetDemo }: SidebarProps) {
  return (
    <aside className="sidebar">
      <div>
        <p className="eyebrow">Web interna</p>
        <h1>COBRAPP</h1>
        <p className="sidebar-copy">
          Lleva cuentas de clientes, registra cambios de saldo y cruza pagos con el banco.
        </p>
      </div>

      <nav className="sidebar-nav">
        <a href="#resumen">Resumen</a>
        <a href="#clientes">Clientes</a>
        <a href="#movimientos">Movimientos</a>
        <a href="#banco">Banco</a>
      </nav>

      <div className="sidebar-note">
        <strong>Palabras simples</strong>
        <p>En la app usaremos terminos claros: cargo, abono, ajuste y banco.</p>
      </div>

      <button className="ghost-button" onClick={onResetDemo} type="button">
        Restaurar demo
      </button>
    </aside>
  );
}

export default Sidebar;
