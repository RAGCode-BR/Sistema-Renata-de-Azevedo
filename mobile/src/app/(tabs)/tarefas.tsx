import { Redirect } from 'expo-router';
import { PatientActivitiesScreen } from '../../components/PatientActivities';
import { useAuth } from '../../lib/auth';

export default function TasksScreen() {
  const { user } = useAuth();
  if (!user?.roles.includes('professional') && !user?.roles.includes('owner')) return <Redirect href="/(tabs)" />;
  return <PatientActivitiesScreen isOwner={user.roles.includes('owner')} />;
}
