import { Text, View, StyleSheet } from 'react-native';
import { DEFAULT_CONFIG } from 'rn-network-quality';

export default function App() {
  return (
    <View style={styles.container}>
      <Text>Network Quality</Text>
      <Text>Default throttle: {DEFAULT_CONFIG.throttleMs} ms</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
