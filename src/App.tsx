import { useEffect, useState } from 'react';
import { Route, Switch } from 'wouter';
import { I18nProvider } from './i18n';
import Login from './screens/Login';
import Collection from './screens/Collection';
import Scan from './screens/Scan';
import Item from './screens/Item';
import Alerts from './screens/Alerts';
import Settings from './screens/Settings';

/**
 * No hay proveedor de identidad externo: la sesión es una cookie firmada que
 * pone el Worker. Aquí solo se comprueba si sigue viva preguntando por /api/me.
 */
function useSession() {
  const [state, setState] = useState<'checking' | 'in' | 'out'>('checking');

  const check = () =>
    fetch('/api/me')
      .then((res) => setState(res.ok ? 'in' : 'out'))
      .catch(() => setState('out'));

  useEffect(() => {
    check();
    const out = () => setState('out');
    window.addEventListener('nefuda:signed-out', out);
    return () => window.removeEventListener('nefuda:signed-out', out);
  }, []);

  return { state, refresh: check };
}

export default function App() {
  const { state, refresh } = useSession();

  return (
    <I18nProvider>
      {state === 'checking' && <div className="screen" aria-busy="true" />}
      {state === 'out' && <Login onDone={refresh} />}
      {state === 'in' && (
        <Switch>
          <Route path="/" component={Collection} />
          <Route path="/escanear" component={Scan} />
          <Route path="/item/:id" component={Item} />
          <Route path="/alertas" component={Alerts} />
          <Route path="/ajustes" component={Settings} />
        </Switch>
      )}
    </I18nProvider>
  );
}
