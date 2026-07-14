import React, { useState, useEffect } from 'react';
import { User, BarChart3, Target, Briefcase, Mail, Building2, Users, TrendingUp, Calendar, CheckCircle2, Circle, Clock } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import NoData from '@/components/NoData';
import { executable } from '@/lib/squidClient';
import toast from 'react-hot-toast';
import Loader from '@/components/Loader';

const WORK_TYPE_COLORS: Record<string, string> = {
  ASSESSMENT: 'bg-purple-500',
  AI_FEATURE: 'bg-blue-500',
  CN_TASK: 'bg-orange-500',
  MSP_TASK: 'bg-green-500',
  INFRASTRUCTURE: 'bg-slate-500',
  SECURITY: 'bg-red-500'
};

export default function DashboardMyAerostack() {
  const [myData, setMyData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [userEmail, setUserEmail] = useState('');
  const [viewMode, setViewMode] = useState<'overview' | 'goals' | 'work'>('overview');
  const [showEmailDialog, setShowEmailDialog] = useState(false);
  const [emailInput, setEmailInput] = useState('you@company.com');

  useEffect(() => {
    // Show dialog on mount
    setShowEmailDialog(true);
  }, []);

  const loadMyData = async (email: string) => {
    setLoading(true);
    try {
      const fn = executable('PeopleOpsService', 'getPersonDashboardEnhanced');
      const data = await fn({
        email,
        include_direct_reports: true,
        include_work_items: true
      });
      setMyData(data);
    } catch (error: any) {
      console.error('Error loading my data:', error);
      toast.error(`Could not load dashboard: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleEmailSubmit = () => {
    if (emailInput.trim()) {
      setUserEmail(emailInput);
      setShowEmailDialog(false);
      loadMyData(emailInput);
    }
  };

  const handleDialogClose = () => {
    setShowEmailDialog(false);
    setLoading(false);
  };

  return (
    <>
      {/* Email Dialog */}
      <Dialog open={showEmailDialog} onOpenChange={setShowEmailDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle id="email-dialog-title">Enter Your Email</DialogTitle>
            <DialogDescription id="email-dialog-description">
              Please enter your email address to view your dashboard.
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleEmailSubmit();
            }}
            aria-labelledby="email-dialog-title"
            aria-describedby="email-dialog-description"
          >
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="email" className="text-sm font-medium">
                  Email Address <span className="text-red-500" aria-label="required">*</span>
                </Label>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  placeholder="you@company.com"
                  value={emailInput}
                  onChange={(e) => setEmailInput(e.target.value)}
                  required
                  aria-required="true"
                  aria-invalid={emailInput.trim() === '' ? 'true' : 'false'}
                  autoComplete="email"
                  autoFocus
                />
              </div>
            </div>
            <DialogFooter className="gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={handleDialogClose}
                aria-label="Cancel and close dialog"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                aria-label="Submit email and continue to dashboard"
              >
                Continue
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {loading && (
        <div className="flex flex-col items-center justify-center min-h-screen p-10">
          <Loader description='Loading your Aerostack'/>
        </div>
      )}

      {!loading && !myData && <NoData className="h-64 m-20" />}

      {!loading && myData && (
        <div className="min-h-screen p-8 bg-slate-50">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <User className="w-9 h-9 text-primary" />
              <h1 className="text-4xl font-bold">My Aerostack</h1>
            </div>
            <p className="text-lg text-muted-foreground">
              {myData.name} • {myData.title} • {myData.department}
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              onClick={() => setViewMode('overview')}
              variant={viewMode === 'overview' ? 'default' : 'outline'}
              className="gap-2"
            >
              <BarChart3 className="w-4 h-4" />
              Overview
            </Button>
            <Button
              onClick={() => setViewMode('goals')}
              variant={viewMode === 'goals' ? 'default' : 'outline'}
              className="gap-2"
            >
              <Target className="w-4 h-4" />
              Goals
            </Button>
            <Button
              onClick={() => setViewMode('work')}
              variant={viewMode === 'work' ? 'default' : 'outline'}
              className="gap-2"
            >
              <Briefcase className="w-4 h-4" />
              Work
            </Button>
          </div>
        </div>

        {/* Status Badges */}
        <div className="flex gap-2 flex-wrap">
          <Badge className="bg-green-500 hover:bg-green-600">
            {myData.employment_status}
          </Badge>
          <Badge className="bg-blue-500 hover:bg-blue-600">
            {myData.employment_type}
          </Badge>
          <Badge className="bg-purple-500 hover:bg-purple-600">
            Access: {myData.access_level}
          </Badge>
        </div>
      </div>

      {/* Overview Mode */}
      {viewMode === 'overview' && (
        <div>
          {/* Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
            <Card className="bg-linear-to-br from-purple-500 to-purple-700 text-white border-0">
              <CardHeader className="pb-2">
                <CardDescription className="text-purple-100">Active Loops</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="text-5xl font-bold">{myData.active_loops}</div>
              </CardContent>
            </Card>

            <Card className="bg-linear-to-br from-pink-500 to-rose-600 text-white border-0">
              <CardHeader className="pb-2">
                <CardDescription className="text-pink-100">Completed Loops</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="text-5xl font-bold">{myData.completed_loops}</div>
              </CardContent>
            </Card>

            <Card className="bg-linear-to-br from-blue-500 to-cyan-500 text-white border-0">
              <CardHeader className="pb-2">
                <CardDescription className="text-blue-100">Current Goals</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="text-5xl font-bold">{myData.current_goals.length}</div>
              </CardContent>
            </Card>

            <Card className="bg-linear-to-br from-green-500 to-emerald-500 text-white border-0">
              <CardHeader className="pb-2">
                <CardDescription className="text-green-100">Engineering Work</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="text-5xl font-bold">{myData.engineering_work.length}</div>
              </CardContent>
            </Card>
          </div>

          {/* Two Column Layout */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
            {/* Employment Info */}
            <Card>
              <CardHeader>
                <CardTitle>Employment Info</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                    <Mail className="w-4 h-4" />
                    Email
                  </div>
                  <div className="font-semibold">{myData.email}</div>
                </div>
                <div>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                    <Building2 className="w-4 h-4" />
                    Department
                  </div>
                  <div className="font-semibold">{myData.department}</div>
                </div>
                <div>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                    <User className="w-4 h-4" />
                    Manager
                  </div>
                  <div className="font-semibold">{myData.manager_name || 'None'}</div>
                </div>
                {myData.direct_reports && myData.direct_reports.length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                      <Users className="w-4 h-4" />
                      Direct Reports
                    </div>
                    <div className="font-semibold">{myData.direct_reports.length} people</div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Performance */}
            <Card>
              <CardHeader>
                <CardTitle>Performance</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
                    <TrendingUp className="w-4 h-4" />
                    Average Loop Score
                  </div>
                  <div className="text-4xl font-bold text-green-600">
                    {myData.avg_score ? myData.avg_score.toFixed(2) : 'N/A'}
                  </div>
                </div>
                <div>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                    <CheckCircle2 className="w-4 h-4" />
                    Goals Completed
                  </div>
                  <div className="font-semibold">{myData.completed_goals_count}</div>
                </div>
                <div>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                    <Calendar className="w-4 h-4" />
                    Upcoming Reviews
                  </div>
                  <div className="font-semibold">{myData.upcoming_reviews.length}</div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Loops Owned */}
          <Card>
            <CardHeader>
              <CardTitle>My Loops</CardTitle>
            </CardHeader>
            <CardContent>
              {myData.loops_owned.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <BarChart3 className="w-16 h-16 mx-auto mb-3 opacity-50" />
                  <div>No loops assigned</div>
                </div>
              ) : (
                <div className="space-y-3">
                  {myData.loops_owned.map((loop: any) => (
                    <div
                      key={loop.loop_id}
                      className={`p-4 rounded-lg bg-slate-50 border-l-4 ${
                        loop.status === 'COMPLETED' ? 'border-l-green-500' : 'border-l-blue-500'
                      }`}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="font-semibold mb-1">{loop.title}</div>
                          <div className="text-sm text-muted-foreground">
                            {loop.category} • {loop.loop_type}
                          </div>
                        </div>
                        <Badge
                          className={
                            loop.status === 'COMPLETED'
                              ? 'bg-green-500 hover:bg-green-600'
                              : 'bg-orange-500 hover:bg-orange-600'
                          }
                        >
                          {loop.status}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Goals Mode */}
      {viewMode === 'goals' && (
        <Card>
          <CardHeader>
            <CardTitle>My Goals</CardTitle>
          </CardHeader>
          <CardContent>
            {myData.current_goals.length === 0 ? (
              <div className="text-center py-16 text-muted-foreground">
                <Target className="w-20 h-20 mx-auto mb-4 opacity-50" />
                <h3 className="text-xl font-semibold mb-2">No Active Goals</h3>
                <p>Set goals to track your professional development</p>
              </div>
            ) : (
              <div className="space-y-6">
                {myData.current_goals.map((goal: any) => (
                  <Card key={goal.goal_id}>
                    <CardHeader>
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <CardTitle className="text-xl">{goal.title}</CardTitle>
                          {goal.description && (
                            <CardDescription className="mt-2">{goal.description}</CardDescription>
                          )}
                        </div>
                        <Badge
                          className={
                            goal.goal_type === 'CAREER'
                              ? 'bg-purple-500 hover:bg-purple-600'
                              : 'bg-blue-500 hover:bg-blue-600'
                          }
                        >
                          {goal.goal_type}
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {/* Progress Bar */}
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-sm text-muted-foreground">Progress</span>
                          <span className="text-sm font-semibold">{goal.progress_percent}%</span>
                        </div>
                        <Progress value={goal.progress_percent} className="h-2" />
                      </div>

                      {/* Milestones */}
                      {goal.milestones && goal.milestones.length > 0 && (
                        <div>
                          <div className="text-sm text-muted-foreground mb-3">Milestones:</div>
                          <div className="space-y-2">
                            {goal.milestones.map((milestone: any, idx: number) => (
                              <div key={idx} className="flex items-center gap-3">
                                {milestone.completed ? (
                                  <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0" />
                                ) : (
                                  <Circle className="w-4 h-4 text-slate-300 flex-shrink-0" />
                                )}
                                <span
                                  className={`text-sm ${
                                    milestone.completed
                                      ? 'line-through text-muted-foreground'
                                      : 'text-foreground'
                                  }`}
                                >
                                  {milestone.milestone}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {goal.target_date && (
                        <div className="flex items-center gap-2 text-sm text-muted-foreground pt-2">
                          <Calendar className="w-4 h-4" />
                          Target: {new Date(goal.target_date).toLocaleDateString()}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Work Mode */}
      {viewMode === 'work' && (
        <Card>
          <CardHeader>
            <CardTitle>My Engineering Work</CardTitle>
          </CardHeader>
          <CardContent>
            {myData.engineering_work.length === 0 ? (
              <div className="text-center py-16 text-muted-foreground">
                <Briefcase className="w-20 h-20 mx-auto mb-4 opacity-50" />
                <h3 className="text-xl font-semibold mb-2">No Work Items</h3>
                <p>You have no engineering work assigned</p>
              </div>
            ) : (
              <div className="space-y-4">
                {myData.engineering_work.map((work: any) => (
                  <div
                    key={work.work_id}
                    className={`p-5 rounded-lg bg-slate-50 border-l-4 ${
                      WORK_TYPE_COLORS[work.work_type]?.replace('bg-', 'border-l-') || 'border-l-slate-500'
                    }`}
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex-1">
                        <h3 className="font-semibold text-lg mb-2">{work.title}</h3>
                        {work.customer_name && (
                          <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <User className="w-3 h-3" />
                            Customer: {work.customer_name}
                          </div>
                        )}
                      </div>
                      <Badge
                        className={
                          work.status === 'done'
                            ? 'bg-green-500 hover:bg-green-600'
                            : work.status === 'blocked'
                            ? 'bg-red-500 hover:bg-red-600'
                            : 'bg-orange-500 hover:bg-orange-600'
                        }
                      >
                        {work.status}
                      </Badge>
                    </div>

                    <div className="flex gap-2 flex-wrap">
                      <Badge className={WORK_TYPE_COLORS[work.work_type] || 'bg-slate-500'}>
                        {work.work_type}
                      </Badge>
                      <Badge variant="secondary">P{work.priority}</Badge>
                      {work.effort_estimate && (
                        <Badge variant="secondary">
                          <Clock className="w-3 h-3 mr-1" />
                          {work.effort_estimate} pts
                        </Badge>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
      )}
    </>
  );
}
