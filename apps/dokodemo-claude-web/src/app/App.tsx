import { AppProviders } from '@/app/providers/AppProviders';
import { NavigationProvider } from '@/app/providers/NavigationProvider';
import { AppContent } from '@/app/AppContent';

function App() {
  return (
    <AppProviders>
      <NavigationProvider>
        <AppContent />
      </NavigationProvider>
    </AppProviders>
  );
}

export default App;
