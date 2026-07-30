import CatThemePicker from '../components/cat/CatThemePicker';
import type { CatTheme } from '../components/cat/CatThemePicker';

export default function CatThemePickerPage() {
  function handleSelect(theme: CatTheme) {
    console.log('Selected theme:', theme.id);
  }

  return (
    <div style={{ width: '100vw', minHeight: '100vh' }}>
      <CatThemePicker onSelect={handleSelect} />
    </div>
  );
}
