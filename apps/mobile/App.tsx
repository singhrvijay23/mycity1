import { useEffect, useMemo, useState } from 'react';
import { BackHandler, Pressable, SafeAreaView, ScrollView, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { currentSession, loadSession, saveSession } from './src/api';
import { Nav, NavCtx, Route } from './src/nav';
import { useTheme } from './src/ui';
import Login from './src/screens/Login';
import Home from './src/screens/Home';
import PostLead from './src/screens/PostLead';
import MyLeads from './src/screens/MyLeads';
import LeadDetail from './src/screens/LeadDetail';
import Chat from './src/screens/Chat';
import VendorLeads from './src/screens/VendorLeads';
import VendorLead from './src/screens/VendorLead';
import Wallet from './src/screens/Wallet';

// Minimal stack navigation keeps the scaffold dependency-free; swap for Expo Router as the app grows.
export default function App() {
  const t = useTheme();
  const [stack, setStack] = useState<Route[] | null>(null);
  const nav: Nav = useMemo(() => ({
    push: (r) => setStack((s) => [...(s ?? []), r]),
    back: () => setStack((s) => (s && s.length > 1 ? s.slice(0, -1) : s)),
    reset: (r) => setStack([r]),
  }), []);

  useEffect(() => {
    loadSession().then((s) => setStack([!s ? { name: 'login' } : s.user.role === 'vendor' ? { name: 'vendorLeads' } : { name: 'home' }]));
  }, []);
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (stack && stack.length > 1) { nav.back(); return true; }
      return false;
    });
    return () => sub.remove();
  }, [stack, nav]);

  if (!stack) return null;
  const r = stack[stack.length - 1];
  const screen = (() => {
    switch (r.name) {
      case 'login': return <Login />;
      case 'home': return <Home />;
      case 'post': return <PostLead categoryId={r.categoryId} text={r.text} />;
      case 'myLeads': return <MyLeads />;
      case 'lead': return <LeadDetail id={r.id} />;
      case 'chat': return <Chat leadId={r.leadId} vendorId={r.vendorId} title={r.title} />;
      case 'vendorLeads': return <VendorLeads />;
      case 'vendorLead': return <VendorLead id={r.id} />;
      case 'wallet': return <Wallet />;
    }
  })();

  return (
    <NavCtx.Provider value={nav}>
      <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
        <StatusBar style="auto" />
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, paddingTop: 40, borderBottomWidth: 1, borderColor: t.line, backgroundColor: t.card }}>
          {stack.length > 1
            ? <Pressable onPress={nav.back}><Text style={{ color: t.brand, fontWeight: '700' }}>‹ Back</Text></Pressable>
            : <Text style={{ fontSize: 20, fontWeight: '800', color: t.text }}>My<Text style={{ color: t.brand }}>City</Text></Text>}
          {currentSession() && r.name !== 'login' && (
            <Pressable onPress={async () => { await saveSession(null); nav.reset({ name: 'login' }); }}><Text style={{ color: t.brand }}>Log out</Text></Pressable>
          )}
        </View>
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48 }} keyboardShouldPersistTaps="handled">{screen}</ScrollView>
      </SafeAreaView>
    </NavCtx.Provider>
  );
}
